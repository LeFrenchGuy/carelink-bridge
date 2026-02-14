import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import axios, { type AxiosInstance } from 'axios';
import * as logger from '../logger.js';
import { loadLoginData, saveLoginData, isTokenExpired, refreshToken } from './token.js';
import { loadProxyList, createProxyAgent, ProxyRotator } from './proxy.js';
import { resolveServerName, buildUrls, type CareLinkUrls } from './urls.js';
import type { CareLinkData, CareLinkUserInfo, CareLinkPatientLink, CareLinkCountrySettings } from '../types/carelink.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REQUESTS_PER_FETCH = 30;
const DEFAULT_MAX_RETRY_DURATION = 512;

export interface CareLinkClientOptions {
  username: string;
  password: string;
  server?: string;
  serverName?: string;
  countryCode?: string;
  lang?: string;
  patientId?: string;
  maxRetryDuration?: number;
}

export class CareLinkClient {
  private axiosInstance: AxiosInstance;
  private proxyRotator: ProxyRotator;
  private urls: CareLinkUrls;
  private loginDataPath: string;
  private serverName: string;
  private options: CareLinkClientOptions;
  private requestCount = 0;

  constructor(options: CareLinkClientOptions) {
    this.options = options;

    const countryCode = options.countryCode || process.env['MMCONNECT_COUNTRYCODE'] || 'gb';
    const lang = options.lang || process.env['MMCONNECT_LANGCODE'] || 'en';

    this.serverName = resolveServerName(
      options.server || process.env['MMCONNECT_SERVER'],
      options.serverName || process.env['MMCONNECT_SERVERNAME'],
    );
    this.urls = buildUrls(this.serverName, countryCode, lang);
    this.loginDataPath = path.join(__dirname, '..', '..', 'logindata.json');

    // Load proxy list
    const useProxy = (process.env['USE_PROXY'] || 'true').toLowerCase() !== 'false';
    const proxyFile = path.join(__dirname, '..', '..', 'https.txt');
    const proxies = useProxy ? loadProxyList(proxyFile) : [];
    this.proxyRotator = new ProxyRotator(proxies);

    // Set up axios
    this.axiosInstance = axios.create({
      maxRedirects: 0,
      timeout: 15_000,
    });

    // Response interceptor: treat 2xx/3xx as success
    this.axiosInstance.interceptors.response.use(
      response => response,
      error => {
        if (error.response?.status >= 200 && error.response?.status < 400) {
          return error.response;
        }
        return Promise.reject(error);
      },
    );

    // Request interceptor: count requests and set headers
    this.axiosInstance.interceptors.request.use(config => {
      this.requestCount++;
      if (this.requestCount > MAX_REQUESTS_PER_FETCH) {
        throw new Error('Request count exceeds the maximum in one fetch!');
      }

      config.headers['User-Agent'] = USER_AGENT;
      config.headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
      config.headers['Accept-Language'] = 'en-US,en;q=0.9';
      config.headers['Accept-Encoding'] = 'gzip, deflate';
      config.headers['Connection'] = 'keep-alive';
      return config;
    });

    // Apply first proxy
    if (this.proxyRotator.hasProxies) {
      this.applyProxy(this.proxyRotator.getNext());
    }
  }

  private applyProxy(proxy: { ip: string; port: string; username?: string; password?: string; protocols: string[] } | null): void {
    if (proxy) {
      const agent = createProxyAgent(proxy);
      if (agent) {
        this.axiosInstance.defaults.httpsAgent = agent;
        this.axiosInstance.defaults.httpAgent = agent;
        console.log(`[Proxy] Using proxy: ${proxy.ip}:${proxy.port}${proxy.username ? ' (authenticated)' : ''}`);
      }
    } else {
      this.axiosInstance.defaults.httpsAgent = undefined;
      this.axiosInstance.defaults.httpAgent = undefined;
    }
  }

  private async authenticate(): Promise<void> {
    let loginData = loadLoginData(this.loginDataPath);
    if (!loginData) {
      throw new Error(
        'No logindata.json found. Run "npm run login" first to authenticate with CareLink.',
      );
    }

    if (isTokenExpired(loginData.access_token)) {
      try {
        loginData = await refreshToken(loginData);
        saveLoginData(this.loginDataPath, loginData);
      } catch (e) {
        // Delete stale logindata so next startup triggers re-login
        try { fs.unlinkSync(this.loginDataPath); } catch { /* ignore */ }
        console.error('[Token] Deleted logindata.json — run "npm run login" to re-authenticate.');
        throw new Error('Refresh token expired. Run "npm run login" to log in again.');
      }
    }

    this.axiosInstance.defaults.headers.common['Authorization'] = 'Bearer ' + loginData.access_token;
    logger.log('Using token-based auth from logindata.json');
    logger.log('Token audience:', loginData.audience);
    logger.log('Token scope:', loginData.scope);
    
    try {
      const parts = loginData.access_token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        logger.log('Token expires:', new Date(payload.exp * 1000).toISOString());
        logger.log('Token issued:', new Date(payload.iat * 1000).toISOString());
        if (payload.permissions) logger.log('Token permissions:', payload.permissions);
        if (payload.token_details?.roles) logger.log('Token roles:', payload.token_details.roles);
      }
    } catch (e) {
      logger.log('Could not decode token payload');
    }
  }

  private async getCurrentRole(): Promise<string> {
    logger.log('GET', this.urls.me);
    const resp = await this.axiosInstance.get<CareLinkUserInfo>(this.urls.me);
    logger.log('Response status:', resp.status);
    logger.log('User role:', resp.data?.role);
    return resp.data?.role?.toUpperCase() ?? '';
  }

  private async getConnectData(): Promise<CareLinkData> {
    const role = await this.getCurrentRole();
    logger.log('getConnectData - currentRole:', role);

    if (role === 'CARE_PARTNER_OUS' || role === 'CARE_PARTNER') {
      return this.fetchAsCarepartner(role);
    }
    return this.fetchAsPatient();
  }

  private async fetchAsCarepartner(role: string): Promise<CareLinkData> {
    logger.log('GET linked patients', this.urls.linkedPatients);
    
    const resp = await this.axiosInstance.get<CareLinkPatientLink[]>(this.urls.linkedPatients);
    const patients = resp.data;

    if (!patients || patients.length === 0) {
      throw new Error('No linked patients found for this carepartner account');
    }

    console.log(`Found ${patients.length} linked patient(s)`);
    patients.forEach(p => logger.log('Patient:', p.username));

    const patient = patients[0];
    console.log(`Fetching data for patient: ${patient.username}`);
    const url = this.urls.connectData(Date.now());
    
    const dataResp = await this.axiosInstance.get<CareLinkData>(url, {
      params: {
        username: patient.username,
        role: 'carepartner',
      },
    });

    if (dataResp.data.sgs) logger.log('Sensor glucose readings:', dataResp.data.sgs.length);
    if (dataResp.data.lastSG) logger.log('Last SG:', dataResp.data.lastSG.sg, 'mg/dL at', dataResp.data.lastSG.datetime);

    logger.log('GET data', url);
    return dataResp.data;
  }

  private async fetchBleDeviceData(): Promise<CareLinkData> {
    console.log('Fetching BLE device data');
    
    logger.log('GET country settings:', this.urls.countrySettings);
    const settingsResp = await this.axiosInstance.get<CareLinkCountrySettings>(this.urls.countrySettings);
    
    const bleEndpoint = settingsResp.data?.blePereodicDataEndpoint;
    logger.log('BLE endpoint from settings:', bleEndpoint);
    
    if (!bleEndpoint) {
      throw new Error('No BLE endpoint found in country settings');
    }
    
    logger.log('GET user info for patientId');
    const userResp = await this.axiosInstance.get<CareLinkUserInfo>(this.urls.me);
    const patientId = userResp.data?.id;
    logger.log('Patient ID:', patientId);
    
    const body: any = {
      username: this.options.username,
      role: 'patient',
      appVersion: 'CareLink Connect 2.0'
    };
    
    if (patientId) {
      body.patientId = patientId;
    }
    
    logger.log('POST to BLE endpoint:', bleEndpoint);
    
    try {
      const resp = await this.axiosInstance.post<any>(bleEndpoint, body, {
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
        },
      });
      
      if (resp.data && resp.status === 200) {
        console.log('Successfully got data from BLE endpoint');
        if (resp.data.sgs) logger.log('Sensor glucose readings:', resp.data.sgs.length);
        if (resp.data.lastSG) logger.log('Last SG:', resp.data.lastSG.sg, 'mg/dL at', resp.data.lastSG.datetime);
        if (resp.data.averageSG) logger.log('Average SG:', resp.data.averageSG);
        if (resp.data.timeInRange) logger.log('Time in range:', resp.data.timeInRange + '%');
        logger.log('GET data', bleEndpoint);
        return resp.data;
      }
      
      throw new Error('BLE endpoint returned empty data');
    } catch (e: any) {
      logger.log('BLE POST failed with status:', e.response?.status);
      logger.log('Error response:', e.response?.data);
      throw e;
    }
  }

  private async fetchAsPatient(): Promise<CareLinkData> {
    logger.log('GET monitor endpoint:', this.urls.monitorData);
    try {
      const resp = await this.axiosInstance.get<CareLinkData>(this.urls.monitorData);
      logger.log('Monitor response status:', resp.status);
      
      if (resp.data && (resp.data as any).deviceFamily) {
        const deviceFamily = (resp.data as any).deviceFamily;
        logger.log('Device family:', deviceFamily);
        
        const isBleDevice = deviceFamily && (
          deviceFamily.includes('BLE') || 
          deviceFamily.includes('MINIMED') || 
          deviceFamily.includes('SIMPLERA')
        );
        
        if (isBleDevice) {
          console.log('BLE device detected, fetching from BLE endpoint');
          return this.fetchBleDeviceData();
        }
      }
      
      if (resp.status === 200 && resp.data && Object.keys(resp.data).length > 1) {
        console.log('Successfully got data from monitor endpoint');
        if (resp.data.sgs) logger.log('Sensor glucose readings:', resp.data.sgs.length);
        if (resp.data.lastSG) logger.log('Last SG:', resp.data.lastSG.sg, 'mg/dL at', resp.data.lastSG.datetime);
        logger.log('GET data', this.urls.monitorData);
        return resp.data;
      }
      logger.log('Monitor endpoint returned minimal data, trying legacy endpoint');
    } catch (e: any) {
      logger.log('Monitor endpoint failed:', e.response?.status, e.message);
    }

    const url = this.urls.connectData(Date.now());
    logger.log('GET legacy connect endpoint:', url);
    const resp = await this.axiosInstance.get<CareLinkData>(url);
    
    if (resp.status === 204 || !resp.data || Object.keys(resp.data).length === 0) {
      console.log('WARNING: Connect endpoint returned no content (HTTP ' + resp.status + ')');
      console.log('This may indicate the device has not uploaded data recently or requires a different endpoint');
    } else {
      console.log('Successfully got data from connect endpoint');
      if (resp.data.sgs) logger.log('Sensor glucose readings:', resp.data.sgs.length);
      if (resp.data.lastSG) logger.log('Last SG:', resp.data.lastSG.sg, 'mg/dL at', resp.data.lastSG.datetime);
    }
    
    logger.log('GET data', url);
    return resp.data;
  }

  async fetch(): Promise<CareLinkData> {
    logger.log('Starting data fetch...');
    this.requestCount = 0;
    this.proxyRotator.resetRetries();

    const maxRetry = this.proxyRotator.hasProxies ? 10 : 1;
    logger.log('Max retries:', maxRetry);

    for (let i = 1; i <= maxRetry; i++) {
      try {
        this.requestCount = 0;
        await this.authenticate();
        const data = await this.getConnectData();
        logger.log('Fetch success!');
        return data;
      } catch (e: unknown) {
        const err = e as { response?: { status: number }; code?: string; cause?: { code?: string }; message?: string };
        const httpStatus = err.response?.status;
        const errorCode = err.code || err.cause?.code || '';
        const isProxyError = [400, 403, 407, 502, 503].includes(httpStatus ?? 0);
        const isNetworkError = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EPROTO', 'ERR_SOCKET_BAD_PORT'].includes(errorCode);

        logger.log(`Attempt ${i} failed: ${httpStatus ? 'HTTP ' + httpStatus : errorCode || (err as Error).message}`);

        if ((isProxyError || isNetworkError) && this.proxyRotator.hasProxies) {
          logger.log('Trying next proxy...');
          const nextProxy = this.proxyRotator.tryNext();
          if (!nextProxy) throw e;
          this.applyProxy(nextProxy);
          await sleep(1000);
          continue;
        }

        if (i === maxRetry) throw e;

        const timeout = Math.pow(2, i);
        await sleep(1000 * timeout);
      }
    }

    throw new Error('Fetch failed after all retries');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
