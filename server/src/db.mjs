// 数据库层。两种实现，接口相同：
// - SQLite（Node 内置 node:sqlite）：本地开发和测试用，数据在 DATA_DIR/zhilema.db
// - MySQL（mysql2）：设置了 MYSQL_ADDRESS 时使用，适合微信云托管（容器磁盘不持久，不能用 SQLite）
//
// 表结构很简单：每个用户的主题 / 记录 / 标签 / 回顾各存成一行 JSON 文档；分享快照单独一张表。

export async function openSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS docs (
      user_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
      data TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind, id)
    );
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS shares_user ON shares (user_id);
  `)
  const q = (sql) => db.prepare(sql)
  return {
    name: 'sqlite',
    async listDocs(user) {
      return q('SELECT kind, id, data, updated_at AS updatedAt FROM docs WHERE user_id = ?').all(user)
    },
    async countDocs(user) {
      return q('SELECT COUNT(*) AS n FROM docs WHERE user_id = ?').get(user).n
    },
    async putDoc(user, kind, id, data, ts) {
      q(`INSERT INTO docs (user_id, kind, id, data, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(user, kind, id, data, ts)
    },
    async delDoc(user, kind, id) {
      q('DELETE FROM docs WHERE user_id = ? AND kind = ? AND id = ?').run(user, kind, id)
    },
    async wipeUser(user) {
      q('DELETE FROM docs WHERE user_id = ?').run(user)
      q('DELETE FROM shares WHERE user_id = ?').run(user)
    },
    async putShare(id, user, data, ts) {
      q('INSERT INTO shares (id, user_id, data, created_at) VALUES (?, ?, ?, ?)').run(id, user, data, ts)
    },
    async getShare(id) {
      return q('SELECT id, user_id AS userId, data, created_at AS createdAt FROM shares WHERE id = ?').get(id) || null
    },
    async listShares(user) {
      return q('SELECT id, data, created_at AS createdAt FROM shares WHERE user_id = ? ORDER BY created_at DESC').all(user)
    },
    async delShare(user, id) {
      return q('DELETE FROM shares WHERE user_id = ? AND id = ?').run(user, id).changes > 0
    },
    async close() {
      db.close()
    },
  }
}

export async function openMysql({ address, user, password, database }) {
  const mysql = (await import('mysql2/promise')).default
  const [host, port] = address.split(':')
  const base = { host, port: Number(port) || 3306, user, password, charset: 'utf8mb4' }
  // 库不存在时先建库
  const boot = await mysql.createConnection(base)
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  await boot.end()
  const pool = mysql.createPool({ ...base, database, connectionLimit: 5 })
  await pool.query(`CREATE TABLE IF NOT EXISTS docs (
    user_id VARCHAR(80) NOT NULL, kind VARCHAR(16) NOT NULL, id VARCHAR(80) NOT NULL,
    data MEDIUMTEXT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, kind, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
  await pool.query(`CREATE TABLE IF NOT EXISTS shares (
    id VARCHAR(32) NOT NULL PRIMARY KEY, user_id VARCHAR(80) NOT NULL,
    data MEDIUMTEXT NOT NULL, created_at BIGINT NOT NULL,
    KEY shares_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
  const rows = async (sql, args) => (await pool.execute(sql, args))[0]
  return {
    name: 'mysql',
    listDocs: (u) => rows('SELECT kind, id, data, updated_at AS updatedAt FROM docs WHERE user_id = ?', [u]),
    countDocs: async (u) => Number((await rows('SELECT COUNT(*) AS n FROM docs WHERE user_id = ?', [u]))[0].n),
    putDoc: (u, kind, id, data, ts) =>
      rows(
        `INSERT INTO docs (user_id, kind, id, data, updated_at) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)`,
        [u, kind, id, data, ts]
      ),
    delDoc: (u, kind, id) => rows('DELETE FROM docs WHERE user_id = ? AND kind = ? AND id = ?', [u, kind, id]),
    async wipeUser(u) {
      await rows('DELETE FROM docs WHERE user_id = ?', [u])
      await rows('DELETE FROM shares WHERE user_id = ?', [u])
    },
    putShare: (id, u, data, ts) => rows('INSERT INTO shares (id, user_id, data, created_at) VALUES (?, ?, ?, ?)', [id, u, data, ts]),
    getShare: async (id) => (await rows('SELECT id, user_id AS userId, data, created_at AS createdAt FROM shares WHERE id = ?', [id]))[0] || null,
    listShares: (u) => rows('SELECT id, data, created_at AS createdAt FROM shares WHERE user_id = ? ORDER BY created_at DESC', [u]),
    delShare: async (u, id) => (await rows('DELETE FROM shares WHERE user_id = ? AND id = ?', [u, id])).affectedRows > 0,
    close: () => pool.end(),
  }
}
