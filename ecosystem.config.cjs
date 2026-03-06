// PM2 config — must be .cjs because package.json has "type": "module"
module.exports = {
  apps: [{
    name: "whatsapp-bot",
    script: "./src/index.js",
    cwd: "/opt/whatsapp-bot",
    env: {
      NODE_ENV: "production",
      // Phase 2 toevoegingen:
      OPENROUTER_API_KEY: "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",
      CLINICMINDS_TA_API_KEY: "mT8qmYLYiP2965eLWswYUpQtPkFkM9CPT4eKnRjjkQkMiPfZnhgR1yvJa54iWCBR",
      DASHBOARD_PORT: "3001",
      DB_PATH: "/opt/whatsapp-bot/data/watch.db",
      KENNIS_DIR: "/opt/whatsapp-bot/kennis",
    },
    restart_delay: 5000,
    max_restarts: 5,
    min_uptime: "10s",
    exp_backoff_restart_delay: 100,
    out_file: "/opt/whatsapp-bot/logs/pm2-out.log",
    error_file: "/opt/whatsapp-bot/logs/pm2-err.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
};
