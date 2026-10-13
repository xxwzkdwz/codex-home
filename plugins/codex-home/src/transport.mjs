import mqtt from 'mqtt';

const MAX_MESSAGE_BYTES = 8192;
// Keep this context-free sink on a disposed client. end(true) closes sockets
// asynchronously and an EventEmitter error without a listener crashes Node.
const ignoreLateError = () => {};

export class HomeError extends Error {
  constructor(code, message, { outcome = 'not_sent', ...details } = {}) {
    super(message);
    this.name = 'HomeError';
    this.code = code;
    this.outcome = outcome;
    this.request_outcome = outcome;
    this.retry_safe = outcome !== 'unknown';
    this.details = { ...details, retry_safe: this.retry_safe };
  }
}

function gatewayState(payload) {
  const raw = payload.toString('utf8').trim();
  if (raw === 'online' || raw === 'offline') return raw;
  try {
    const state = JSON.parse(raw)?.state;
    return state === 'online' || state === 'offline' ? state : undefined;
  } catch {
    return undefined;
  }
}

function lightState(payload) {
  try {
    const state = JSON.parse(payload.toString('utf8'))?.state;
    return state === 'ON' || state === 'OFF' ? state : undefined;
  } catch {
    return undefined;
  }
}

/** One short-lived, non-reconnecting connection per operation. */
export class MqttTransport {
  constructor({ connect = mqtt.connect } = {}) {
    this.connect = connect;
  }

  async health(config, { signal } = {}) {
    return this.#run(config, undefined, 'health', undefined, signal);
  }

  async status(config, device, { signal } = {}) {
    return this.#run(config, device, 'get', undefined, signal);
  }

  async setState(config, device, state, { signal } = {}) {
    if (state !== 'ON' && state !== 'OFF') {
      throw new HomeError('INVALID_STATE', 'Only ON and OFF are supported.');
    }
    return this.#run(config, device, 'set', state, signal);
  }

  #run(config, device, operation, requestedState, signal) {
    const settings = config.mqtt;
    const bridgeTopic = `${settings.base_topic}/bridge/state`;
    const stateTopic = device ? `${settings.base_topic}/${device.mqtt_topic}` : undefined;
    const availabilityTopic = device?.require_availability ? `${stateTopic}/availability` : undefined;
    const topics = [bridgeTopic, ...(availabilityTopic ? [availabilityTopic] : []), ...(stateTopic ? [stateTopic] : [])];
    const topicSet = new Set(topics);

    return new Promise((resolve, reject) => {
      let client;
      let clientCleaned = false;
      let done = false;
      let subscribed = false;
      let connectHandled = false;
      let bridge;
      let availability;
      let requestStarted = false;
      let controlMayHaveBeenSent = false;
      const timer = setTimeout(() => fail('MQTT_TIMEOUT', 'Timed out waiting for the gateway. A state change may have occurred if the outcome is unknown.'), settings.timeout_ms);

      const listeners = {
        connect: onConnect,
        message: onMessage,
        error: onError,
        close: onDisconnect,
        disconnect: onDisconnect,
        offline: onDisconnect,
      };

      function cleanupClient() {
        // Force-close rather than flushing any queued QoS 0 publication.
        if (client && !clientCleaned) {
          clientCleaned = true;
          if (!client.listeners('error').includes(ignoreLateError)) client.on('error', ignoreLateError);
          for (const [event, handler] of Object.entries(listeners)) client.off(event, handler);
          try { client.end(true); } catch { /* Best-effort socket cleanup. */ }
        }
      }

      function finish(error, result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        cleanupClient();
        if (error) reject(error);
        else resolve(result);
      }

      function fail(code, message) {
        finish(new HomeError(code, message, {
          outcome: controlMayHaveBeenSent ? 'unknown' : 'not_sent',
        }));
      }

      function onAbort() {
        fail('REQUEST_ABORTED', 'The request was cancelled. A state change may have occurred if the outcome is unknown.');
      }

      function shouldStop() {
        if (done) return true;
        if (signal?.aborted) {
          onAbort();
          return true;
        }
        return false;
      }

      function onError() {
        // Never return broker errors: they can contain URLs and credentials.
        fail('MQTT_CONNECTION_ERROR', 'The MQTT connection failed.');
      }

      function onDisconnect() {
        fail('MQTT_DISCONNECTED', 'The MQTT connection closed before confirmation.');
      }

      function onConnect() {
        if (shouldStop() || connectHandled) return;
        connectHandled = true;
        try {
          client.subscribe(topics, { qos: 0 }, (error, granted) => {
            if (shouldStop()) return;
            if (error || !Array.isArray(granted) || topics.some(topic => !granted.some(item => item.topic === topic && Number.isInteger(item.qos) && item.qos >= 0 && item.qos <= 2))) {
              fail('MQTT_SUBSCRIBE_FAILED', 'The broker did not authorize all required subscriptions.');
              return;
            }
            subscribed = true;
            advance();
          });
        } catch {
          fail('MQTT_SUBSCRIBE_FAILED', 'The required MQTT subscriptions could not be established.');
        }
      }

      function advance() {
        if (shouldStop() || !subscribed) return;
        if (operation === 'health') {
          if (bridge) finish(undefined, { bridge_state: bridge, observed_at: new Date().toISOString() });
          return;
        }
        if (bridge === 'offline') {
          fail('BRIDGE_OFFLINE', 'The Zigbee2MQTT gateway reports offline.');
          return;
        }
        if (availability === 'offline') {
          fail('DEVICE_OFFLINE', 'The device reports offline.');
          return;
        }
        if (bridge !== 'online' || (availabilityTopic && availability !== 'online') || requestStarted) return;
        if (shouldStop()) return;
        requestStarted = true;
        // From invocation onward, /set may have reached the gateway even if a
        // callback fails. No retry and no MQTT reconnect can replay the action.
        controlMayHaveBeenSent = operation === 'set';
        const body = operation === 'set' ? { state: requestedState } : { state: '' };
        try {
          client.publish(`${stateTopic}/${operation}`, JSON.stringify(body), { qos: 0, retain: false }, error => {
            if (!done && error) fail('MQTT_PUBLISH_FAILED', 'The MQTT request could not be confirmed.');
          });
        } catch {
          fail('MQTT_PUBLISH_FAILED', 'The MQTT request could not be confirmed.');
        }
      }

      function onMessage(topic, payload, packet = {}) {
        if (shouldStop() || !topicSet.has(topic)) return;
        if (!Buffer.isBuffer(payload) || payload.length > MAX_MESSAGE_BYTES) {
          fail('MQTT_INVALID_MESSAGE', 'The gateway sent an invalid or oversized message.');
          return;
        }
        if (topic === bridgeTopic) {
          bridge = gatewayState(payload);
          advance();
          return;
        }
        if (topic === availabilityTopic) {
          availability = gatewayState(payload);
          advance();
          return;
        }
        // Retained messages (and any report before publication) are cache, not
        // confirmation. Z2M has no correlation ID: even a fresh report does not
        // prove physical illumination or uniquely identify our request.
        if (!requestStarted || packet.retain !== false) return;
        const state = lightState(payload);
        if (!state || (operation === 'set' && state !== requestedState)) return;
        finish(undefined, {
          state,
          confirmation: 'fresh_gateway_report',
          observed_at: new Date().toISOString(),
          ...(operation === 'set' ? { requested_state: requestedState } : {}),
          request_outcome: 'confirmed',
        });
      }

      signal?.addEventListener('abort', onAbort, { once: true });
      if (shouldStop()) return;
      try {
        client = this.connect(settings.url, {
          clean: true,
          reconnectPeriod: 0,
          reconnectOnConnackError: false,
          resubscribe: false,
          queueQoSZero: false,
          connectTimeout: settings.timeout_ms,
          rejectUnauthorized: true,
          ...(settings.username !== undefined ? { username: settings.username } : {}),
          ...(settings.password !== undefined ? { password: settings.password } : {}),
          ...(settings.ca !== undefined ? { ca: settings.ca } : {}),
        });
        // An injected connect implementation can abort synchronously while
        // constructing the client. It still needs closing, but no subscription.
        if (shouldStop()) {
          cleanupClient();
          return;
        }
        for (const [event, handler] of Object.entries(listeners)) client.on(event, handler);
      } catch {
        fail('MQTT_CONNECTION_ERROR', 'The MQTT connection could not be established.');
      }
    });
  }
}
