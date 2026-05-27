import express, { Request, Response } from 'express';
import { GoogleAuth } from 'google-auth-library';
import fetch, { RequestInit } from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '2mb' }));

// 从环境变量读取 Service Account Key 秘钥信息
const keyStr = process.env.GCP_SERVICE_ACCOUNT_KEY;
if (!keyStr) {
  console.error('❌ 环境变量 GCP_SERVICE_ACCOUNT_KEY 未配置');
  process.exit(1);
}

let credentials: any;
try {
  credentials = JSON.parse(keyStr);
  // 恢复换行符，以便 google-auth-library 正常加载 PEM 证书
  credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
} catch (e: any) {
  console.error('❌ GCP_SERVICE_ACCOUNT_KEY 解析失败：', e.message);
  process.exit(1);
}

// 初始化 GoogleAuth 身份验证实例
const auth = new GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/**
 * 转发请求到 Google Vertex AI
 * @param req Express 请求对象
 * @param res Express 响应对象
 */
async function forwardToVertex(req: Request, res: Response) {
  try {
    // 1. 获取 Google 访问 Token
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;
    if (!token) {
      throw new Error('未获取到 Access Token');
    }

    // 2. 构造目标 Vertex AI REST 接口 URL 路径
    const project = process.env.GCP_PROJECT_ID || 'vertex-ai-for-vercel';
    const location = process.env.GCP_LOCATION || 'us-central1';
    const model = (req.headers['x-vertex-model'] as string) || 'gemini-2.5-flash';
    const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

    // 3. 构造请求参数，完全透传前端的 Payload 内容
    const fetchOpts: RequestInit = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000), // 30秒超时保护，防止请求挂起
    };

    // 4. 发起 HTTP 转发并向前端透传完整的响应内容
    const vertexResp = await fetch(vertexUrl, fetchOpts);
    const respBody = await vertexResp.text();

    res
      .status(vertexResp.status)
      .set('Content-Type', 'application/json')
      .send(respBody);
  } catch (err: any) {
    console.error('🔴 代理层转发发生异常：', err.message);
    res
      .status(502)
      .json({ error: 'proxy_error', message: err.message ?? 'unknown' });
  }
}

// 注册路由
app.post('/api/vertex-proxy', forwardToVertex);

export default app;
