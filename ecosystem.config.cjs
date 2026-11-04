module.exports = {
  apps: [
    {
      name: 'pi-agent',
      cwd: __dirname,
      script: 'npm',
      args: 'start',
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 10000,
      listen_timeout: 10000,
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
