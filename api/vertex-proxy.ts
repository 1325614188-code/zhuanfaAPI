import express, { Request, Response } from 'express';
import { GoogleAuth } from 'google-auth-library';
import fetch, { RequestInit } from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '2mb' }));

// 缓存 GoogleAuth 实例以重用连接，提升运行速度
let cachedAuth: GoogleAuth | null = null;

/**
 * 懒加载获取 GoogleAuth 身份验证实例
 */
function getGoogleAuth(): GoogleAuth {
  if (cachedAuth) {
    return cachedAuth;
  }

  const keyStr = process.env.GCP_SERVICE_ACCOUNT_KEY;
  if (!keyStr) {
    throw new Error('环境变量 GCP_SERVICE_ACCOUNT_KEY 未配置');
  }

  try {
    const credentials = JSON.parse(keyStr);
    // 恢复换行符以使 google-auth-library 正常解析 PEM 密钥
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');

    cachedAuth = new GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    return cachedAuth;
  } catch (e: any) {
    throw new Error(`GCP_SERVICE_ACCOUNT_KEY 解析失败: ${e.message}`);
  }
}

/**
 * 转发请求到 Google Vertex AI
 * @param req Express 请求对象
 * @param res Express 响应对象
 */
async function forwardToVertex(req: Request, res: Response) {
  try {
    // 1. 初始化或获取 GoogleAuth 实例 (完全隔离，防止全局 process.exit 导致 Serverless 崩溃)
    const auth = getGoogleAuth();

    // 2. 获取 Google 访问 Token
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = tokenResponse.token;
    if (!token) {
      throw new Error('未获取到 Access Token');
    }

    // 3. 构造目标 Vertex AI REST 接口 URL 路径
    const project = process.env.GCP_PROJECT_ID || 'vertex-ai-for-vercel';
    const location = process.env.GCP_LOCATION || 'us-central1';
    const model = (req.headers['x-vertex-model'] as string) || 'gemini-2.5-flash';
    const vertexUrl = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

    // 4. 构造请求参数，完全透传前端的 Payload 内容
    const fetchOpts: RequestInit = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30000), // 30秒超时保护
    };

    // 5. 发起 HTTP 转发并向前端透传完整的响应内容
    const vertexResp = await fetch(vertexUrl, fetchOpts);
    const respBody = await vertexResp.text();

    res
      .status(vertexResp.status)
      .set('Content-Type', 'application/json')
      .send(respBody);
  } catch (err: any) {
    console.error('🔴 代理层转发发生异常：', err.message);
    res
      .status(500)
      .json({ error: 'proxy_error', message: err.message ?? 'unknown' });
  }
}

/**
 * 转发请求到 EasyRouter
 * @param req Express 请求对象
 * @param res Express 响应对象
 */
async function forwardToEasyRouter(req: Request, res: Response) {
  try {
    // 1. 获取路径中的相对地址，剥离 /api/easyrouter-proxy 前缀
    const originalUrl = req.url || '';
    const targetPath = originalUrl.replace(/^\/api\/easyrouter-proxy/, '').replace(/^\/easyrouter-proxy/, '');
    
    // 2. 目标地址：EasyRouter 官方 API 端点
    const targetUrl = `https://easyrouter.io${targetPath}`;
    console.log(`[EasyRouter Proxy] Forwarding request to: ${targetUrl}`);

    // 3. 构建请求参数，完全透传前端的 Payload，并透传 Bearer Token
    const fetchOpts: RequestInit = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization || '',
      },
      body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(30000), // 30秒超时保护
    };

    // 4. 发起 HTTP 转发并透传完整的响应内容
    const easyrouterResp = await fetch(targetUrl, fetchOpts);
    const respBody = await easyrouterResp.text();

    res
      .status(easyrouterResp.status)
      .set('Content-Type', 'application/json')
      .send(respBody);
  } catch (err: any) {
    console.error('🔴 EasyRouter 代理层转发发生异常：', err.message);
    res
      .status(500)
      .json({ error: 'easyrouter_proxy_error', message: err.message ?? 'unknown' });
  }
}

// 注册路由（基于路径智能判断，分流至 Google 官方或 EasyRouter，确保旧有直连绝对不冲突）
app.all('*', (req: Request, res: Response) => {
  if (req.path.includes('easyrouter-proxy')) {
    return forwardToEasyRouter(req, res);
  } else {
    return forwardToVertex(req, res);
  }
});

// 在非 Vercel 环境下（例如 Deno、Docker、自建 VPS），自动启动端口监听服务
if (process.env.PORT || process.env.ZEABUR) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Standalone server is running on port ${PORT}`);
  });
}

export default app;
