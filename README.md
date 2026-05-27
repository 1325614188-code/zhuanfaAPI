# Google Vertex AI 代理转发服务 (Vercel)

本项目是一个轻量级的 Serverless 转发代理，用于将前端请求安全、高效地转发至 Google Vertex AI API。

## 适用场景

适用于在大陆部署的服务器（如阿里云、腾讯云等），由于网络阻断无法直连 Google API 的情况。可以通过部署至 Vercel，将该服务作为一个透明代理节点，实现顺畅的 Vertex AI 模型调用。

## 部署与配置步骤

1. 将本项目导入到你的 Vercel 账号中。
2. 在 Vercel 的项目设置 (Settings -> Environment Variables) 中配置以下三个环境变量：
   - `GCP_SERVICE_ACCOUNT_KEY`: Google Cloud Service Account 账号的完整单行 JSON 秘钥（需确保该 Service Account 已被授予 `Vertex AI User` 权限）。
   - `GCP_PROJECT_ID`: 你的 Google Cloud 项目 ID。
   - `GCP_LOCATION`: 你的 Vertex AI 服务部署区域（默认 `us-central1`）。
3. 部署成功后，将你的阿里云项目环境变量 `GCP_VERTEX_PROXY` 指向 Vercel 提供的生成 URL，形如 `https://your-project.vercel.app/api/vertex-proxy`。

## 技术规范说明

- 默认采用 **React + TypeScript / Node.js** 规范。
- 遵循 **ESM (ECMAScript Modules)** 模块体系标准。
- 所有函数与逻辑严格按照 `RULE[user_global]` 命名规则与注释规范实现。
