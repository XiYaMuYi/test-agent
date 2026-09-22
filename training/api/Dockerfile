FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY api/package.json api/tsconfig.json api/tsconfig.build.json api/nest-cli.json api/
COPY worker/package.json worker/tsconfig.json worker/tsconfig.test.json worker/
COPY contracts/package.json contracts/tsconfig.json contracts/tsconfig.build.json contracts/
COPY test-fixtures/package.json test-fixtures/tsconfig.json test-fixtures/tsconfig.build.json test-fixtures/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm --filter @training/contracts run build && pnpm --filter @training/api run build
EXPOSE 3000
CMD ["node", "api/dist/main.js"]
