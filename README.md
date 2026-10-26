# github-contrib-report

> A GitHub App built with [Probot](https://github.com/probot/probot) that An app that gives unbiased contribution reports on GitHub Repos.

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t github-contrib-report .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> github-contrib-report
```

## Contributing

If you have suggestions for how github-contrib-report could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2026 Noah Arrowsmith
