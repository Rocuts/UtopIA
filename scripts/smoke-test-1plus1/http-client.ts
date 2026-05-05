// scripts/smoke-test-1plus1/http-client.ts
// Mini fetch-wrapper con cookie jar y timeout.
// Propaga utopia_workspace_id entre requests.

export interface HttpResponse {
  status: number;
  ok: boolean;
  body: unknown;
  headers: Headers;
  cookiesSet: string[];
}

export class HttpClient {
  private cookie: string;
  private base: string;
  private timeoutMs: number;

  constructor(base: string, timeoutMs: number, initialCookie = '') {
    this.base = base.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.cookie = initialCookie;
  }

  /** Devuelve la cookie acumulada (utopia_workspace_id=...) */
  getCookie(): string {
    return this.cookie;
  }

  private mergeCookies(setCookieHeaders: string[]): void {
    for (const raw of setCookieHeaders) {
      // Formato: "name=value; Path=...; HttpOnly; ..."
      const pair = raw.split(';')[0]?.trim();
      if (!pair) continue;
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      if (!name) continue;
      // Reemplazar o agregar
      const regex = new RegExp(`(?:^|; )${name}=[^;]*`);
      if (regex.test(this.cookie)) {
        this.cookie = this.cookie.replace(regex, `${name}=${value}`);
        // Limpiar posibles "; " duplicados
        this.cookie = this.cookie.replace(/^; /, '');
      } else {
        this.cookie = this.cookie ? `${this.cookie}; ${name}=${value}` : `${name}=${value}`;
      }
    }
  }

  async request(
    method: string,
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      isFormData?: boolean;
    } = {},
  ): Promise<HttpResponse> {
    const url = `${this.base}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const reqHeaders: Record<string, string> = {
      ...(this.cookie ? { Cookie: this.cookie } : {}),
      ...(options.headers ?? {}),
    };

    if (options.body !== undefined && !options.isFormData) {
      reqHeaders['Content-Type'] = 'application/json';
    }

    const init: RequestInit = {
      method,
      headers: reqHeaders,
      signal: controller.signal,
    };

    if (options.body !== undefined) {
      if (options.isFormData) {
        init.body = options.body as FormData;
      } else {
        init.body = JSON.stringify(options.body);
      }
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } finally {
      clearTimeout(timer);
    }

    // Capturar Set-Cookie
    const setCookieHeaders: string[] = [];
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        setCookieHeaders.push(value);
      }
    });
    // Node fetch solo expone el primer Set-Cookie via getSetCookie() en Node 18+
    if (typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
      const multi = (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
      setCookieHeaders.push(...multi.filter((h) => !setCookieHeaders.includes(h)));
    }
    this.mergeCookies(setCookieHeaders);

    let body: unknown;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      body = await res.json().catch(() => null);
    } else {
      body = await res.text().catch(() => '');
    }

    return {
      status: res.status,
      ok: res.ok,
      body,
      headers: res.headers,
      cookiesSet: setCookieHeaders,
    };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.request('GET', path, { headers });
  }

  post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request('POST', path, { body, headers });
  }

  postForm(path: string, formData: FormData) {
    return this.request('POST', path, { body: formData, isFormData: true });
  }
}
