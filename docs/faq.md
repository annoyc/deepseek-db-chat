# Frequently Asked Questions

Common questions about **DBPilot** — an AI-powered MySQL assistant.

---

## General

### What databases are supported?

Currently **MySQL only**. PostgreSQL and SQLite support is planned.

### Is my data safe?

Yes. All chat history is stored in your browser's **IndexedDB**. No data is sent to any server except the DeepSeek API for AI processing. No login or registration is required.

Your database credentials are stored server-side in `data/connections.json` (local to your deployment) and are never sent to DeepSeek.

### Can AI execute dangerous SQL?

No. Every SQL query requires your **explicit confirmation** before execution. Dangerous operations (such as `DROP`, `DELETE`, `TRUNCATE`, and `ALTER`) are clearly flagged in the confirmation dialog so you can review them before approving.

---

## Setup

### How do I get a DeepSeek API key?

Visit [https://platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) to create one. Copy the key and set it in your `.env` file or through the in-app settings dialog.

### Can I use a custom API endpoint?

Yes. Set `DEEPSEEK_API_BASE_URL` in your `.env` file to point to a custom endpoint or proxy:

```env
DEEPSEEK_API_BASE_URL=https://your-proxy.example.com
```

The default is `https://api.deepseek.com`.

### Which model should I use?

| Model | Best for |
|-------|----------|
| **deepseek-v4-flash** (default) | Faster and cheaper — good for most queries |
| **deepseek-v4-pro** | Better reasoning for complex analytical queries |

You can switch models in the in-app settings dialog.

---

## Troubleshooting

### I get "DEEPSEEK_API_KEY is required" error

Set the API key in one of two ways:

1. **`.env` file** — add `DEEPSEEK_API_KEY=sk-...` to your project root `.env`
2. **Settings dialog** — open the in-app settings and enter your API key there

Restart the dev server after changing `.env` values.

### Database connection fails

Check the following:

1. **MySQL is running** — verify the MySQL server process is active
2. **Network access** — confirm the host and port are reachable from the app server
3. **Credentials** — verify username, password, and database name are correct
4. **Permissions** — ensure the MySQL user has `SELECT` (and other required) privileges on the target database

You can test connectivity independently with the `mysql` CLI:

```bash
mysql -h localhost -P 3306 -u root -p your_database
```

### The AI gives wrong SQL

The AI may occasionally generate incorrect SQL — this is why **human confirmation is required** before any query runs. If the generated SQL looks wrong:

1. Click **Cancel** in the SQL confirmation dialog
2. Rephrase your question with more specific details (table names, column names, filters)
3. Try switching to **deepseek-v4-pro** for complex queries

### Responses are slow

Try these steps:

1. **Use deepseek-v4-flash** — it is faster and cheaper than the pro model
2. **First requests may be slower** — initial requests can take longer due to cache misses
3. **Subsequent queries are faster** — similar queries benefit from DeepSeek's context caching

### How do I reset chat history?

Chat history is stored in browser **IndexedDB**. To clear it:

- **Browser dev tools** — open Application → IndexedDB → delete the relevant database
- **App clear function** — use the clear/reset option in the chat interface (if available)

Clearing IndexedDB does not affect your database connections or server-side configuration.
