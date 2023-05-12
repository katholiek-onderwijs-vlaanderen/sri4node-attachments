const undici = require('undici');
const FormData = require('form-data');

/**
 * @typedef {'GET' | 'PUT' | 'DELETE' | 'PATCH' | 'POST'} THttpMethod
 */

/**
 * @typedef {Object.<string, string | string[] | undefined>} THttpHeaders
 */

/**
 * @typedef {Object} THttpRequest
 * @property {string} path
 * @property {*} [body] - TODO: restrict
 * @property {boolean} [streaming]
 * @property {string} [auth]
 * @property {THttpHeaders} [headers]
 */

/**
 * @typedef {Object} THttpResponse
 * @property {number} status
 * @property {THttpHeaders} headers
 * @property {THttpHeaders} trailers
 * @property {*} body - TODO: restrict
 */

/**
 * @typedef {Object} THttpClient
 * @property {(req: THttpRequest) => Promise<THttpResponse>} get
 * @property {(req: THttpRequest) => Promise<THttpResponse>} put
 * @property {(req: THttpRequest) => Promise<THttpResponse>} delete
 * @property {(req: THttpRequest) => Promise<THttpResponse>} post
 * @property {(req: THttpRequest) => Promise<THttpResponse>} patch
 */

/**
 * @param {string} user
 * @param {string} pw
 * @returns {string}
 */
const makeBasicAuthHeader = (user, pw) => {
  return `Basic ${Buffer.from(`${user}:${pw}`).toString('base64')}`;
};

/**
 * @param {THttpMethod} method
 * @param {THttpRequest} req
 * @param {undici.Client} undiciClient
 * @returns {Promise<THttpResponse>}
 */
const handleHttpRequest = async (method, req, undiciClient) => {
  const reqHeaders = {
    'content-type': 'application/json; charset=utf-8',
    ...(req.auth
      ? { authorization: makeBasicAuthHeader(`${req.auth}@email.be`, 'pwd') }
      : {}),
    ...req.headers,
  };

  try {
    const { statusCode, headers, body, trailers } = await undiciClient.request({
      path: req.path,
      method,
      headers: reqHeaders,
      body:
        typeof req.body === 'string' || req.body instanceof FormData
          ? req.body
          : JSON.stringify(req.body),
    });

    return {
      status: statusCode,
      headers,
      trailers,
      body: req.streaming
        ? body
        : headers['content-type'] === 'application/json; charset=utf-8'
        ? await body.json()
        : await body.text(),
    };
  } catch (err) {
    console.log('Http request FAILED:');
    console.log(err);
    throw 'httpclient.failure';
  }
};

module.exports = {
  /**
   * @param {string} base
   * @returns {THttpClient}
   */
  httpClientFactory: (base) => {
    const undiciClient = new undici.Client(base);

    return {
      get: (req) => handleHttpRequest('GET', req, undiciClient),
      put: (req) => handleHttpRequest('PUT', req, undiciClient),
      delete: (req) => handleHttpRequest('DELETE', req, undiciClient),
      post: (req) => handleHttpRequest('POST', req, undiciClient),
      patch: (req) => handleHttpRequest('PATCH', req, undiciClient),
    };
  },
};