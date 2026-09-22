import { createHash } from 'node:crypto';

import type { IdentityProviderPort, IdentityRequestContext, VerifiedPrincipal } from '@training/contracts';

interface GongzhugouIdentityResponse {
  readonly code?: number;
  readonly customer_id?: string | number;
  readonly customerId?: string | number;
  readonly active?: boolean;
  readonly data?: GongzhugouIdentityResponse;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MALL_CURRENT_USER_URL = 'https://rapi.gongzhugou.vip/v1/customer/info/get';
const MALL_APP_VERSION = '8.11.7';
const MALL_PROTOCOL_VERSION = '2.3.6';
const MALL_PLATFORM = 'weixin';
const MALL_OS = 'none';
// This protocol value is already used by the first-party mini-program request signer.
const MALL_SIGNATURE_SALT = '[v9HVx?pNJvLF2)mp3DqZR9GrLk3Udq3';

export class GongzhugouIdentityAdapter implements IdentityProviderPort {
  public constructor(
    private readonly organizationId: string,
    private readonly timeoutMs = 5000,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async verifyAccessToken(token: string, context?: IdentityRequestContext): Promise<VerifiedPrincipal> {
    const openId = context?.openId?.trim();
    const deviceId = context?.deviceId?.trim();
    if (!openId || !deviceId) {
      throw new Error('Missing signed Gongzhugou device identity.');
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await this.fetchFn(MALL_CURRENT_USER_URL + '?' + new URLSearchParams({
      device: openId,
      device_id: deviceId,
      version: MALL_APP_VERSION,
      v: MALL_PROTOCOL_VERSION,
      platform: MALL_PLATFORM,
      os: MALL_OS,
      timestamp: String(timestamp),
      sign: this.sign({ device: openId, device_id: deviceId, version: MALL_APP_VERSION, v: MALL_PROTOCOL_VERSION, platform: MALL_PLATFORM, os: MALL_OS, timestamp, 'x-token': token }),
    }).toString(), {
      method: 'GET',
      headers: {
        cookie: `device=${openId};device_id=${deviceId};v=${MALL_PROTOCOL_VERSION};platform=${MALL_PLATFORM};version=${MALL_APP_VERSION};token=${token};gzg_test_user=`,
        'content-type': 'application/json;charset=utf-8',
        'x-token': token,
        device_id: deviceId,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Gongzhugou identity introspection returned HTTP ${response.status}.`);
    const body = await response.json() as GongzhugouIdentityResponse;
    if (body.code === 1101) throw new Error('Gongzhugou access token is invalid.');
    const principal = body.data || body;
    const customerId = principal.customer_id ?? principal.customerId;
    if (body.code !== undefined && body.code !== 0) {
      throw new Error('Gongzhugou identity response was not successful.');
    }
    if ((principal.active === false) || (customerId === undefined || customerId === null || customerId === '')) {
      throw new Error('Gongzhugou identity response did not contain an active customer.');
    }
    return { subjectId: String(customerId), organizationId: this.organizationId, status: 'active' };
  }

  private sign(values: Readonly<Record<string, string | number>>): string {
    const payload = Object.entries(values)
      .filter(([, value]) => value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${decodeURIComponent(String(value).replace(/%/g, '%25'))}`)
      .join('&');
    return createHash('md5').update(`${MALL_SIGNATURE_SALT}${payload}${MALL_SIGNATURE_SALT}`, 'utf8').digest('hex').toUpperCase();
  }
}
