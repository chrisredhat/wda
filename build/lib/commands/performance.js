"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.commands = void 0;

require("source-map-support/register");

var _lodash = _interopRequireDefault(require("lodash"));

var _path = _interopRequireDefault(require("path"));

var _appiumSupport = require("appium-support");

var _teen_process = require("teen_process");

var _logger = _interopRequireDefault(require("../logger"));

var _utils = require("../utils");

var _asyncbox = require("asyncbox");

let commands = {};
exports.commands = commands;
const RECORDERS_CACHE = {};
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const STOP_TIMEOUT_MS = 3 * 60 * 1000;
const START_TIMEOUT_MS = 15 * 1000;
const DEFAULT_PROFILE_NAME = 'Activity Monitor';
const DEFAULT_EXT = '.trace';

async function finishPerfRecord(proc, stopGracefully = true) {
  if (!proc.isRunning) {
    return;
  }

  if (stopGracefully) {
    _logger.default.debug(`Sending SIGINT to the running instruments process`);

    return await proc.stop('SIGINT', STOP_TIMEOUT_MS);
  }

  _logger.default.debug(`Sending SIGTERM to the running instruments process`);

  await proc.stop();
}

async function uploadTrace(localFile, remotePath = null, uploadOptions = {}) {
  try {
    return await (0, _utils.encodeBase64OrUpload)(localFile, remotePath, uploadOptions);
  } finally {
    await _appiumSupport.fs.rimraf(localFile);
  }
}

commands.mobileStartPerfRecord = async function mobileStartPerfRecord(opts = {}) {
  if (!this.relaxedSecurityEnabled && !this.isRealDevice()) {
    _logger.default.errorAndThrow(`Appium server must have relaxed security flag set in order ` + `for Simulator performance measurement to work`);
  }

  const {
    timeout = DEFAULT_TIMEOUT_MS,
    profileName = DEFAULT_PROFILE_NAME,
    pid
  } = opts;
  const runningRecorders = RECORDERS_CACHE[profileName];

  if (_lodash.default.isPlainObject(runningRecorders) && runningRecorders[this.opts.device.udid]) {
    const {
      proc,
      localPath
    } = runningRecorders[this.opts.device.udid];
    await finishPerfRecord(proc, false);

    if (await _appiumSupport.fs.exists(localPath)) {
      await _appiumSupport.fs.rimraf(localPath);
    }

    delete runningRecorders[this.opts.device.udid];
  }

  if (!(await _appiumSupport.fs.which('instruments'))) {
    _logger.default.errorAndThrow(`Cannot start performance recording, because 'instruments' ` + `tool cannot be found in PATH. Are Xcode development tools installed?`);
  }

  const localPath = await _appiumSupport.tempDir.path({
    prefix: `appium_perf_${profileName}_${Date.now()}`.replace(/\W/g, '_'),
    suffix: DEFAULT_EXT
  });
  const args = ['-w', this.opts.device.udid, '-t', profileName, '-D', localPath, '-l', timeout];

  if (pid) {
    if (`${pid}`.toLowerCase() === 'current') {
      const appInfo = await this.proxyCommand('/wda/activeAppInfo', 'GET');
      args.push('-p', appInfo.pid);
    } else {
      args.push('-p', pid);
    }
  }

  const proc = new _teen_process.SubProcess('instruments', args);

  _logger.default.info(`Starting 'instruments' with arguments: ${args.join(' ')}`);

  proc.on('exit', code => {
    const msg = `instruments exited with code '${code}'`;

    if (code) {
      _logger.default.warn(msg);
    } else {
      _logger.default.debug(msg);
    }
  });
  proc.on('output', (stdout, stderr) => {
    (stdout || stderr).split('\n').filter(x => x.length).map(x => _logger.default.debug(`[instruments] ${x}`));
  });
  await proc.start(0);

  try {
    await (0, _asyncbox.waitForCondition)(async () => await _appiumSupport.fs.exists(localPath), {
      waitMs: START_TIMEOUT_MS,
      intervalMs: 500
    });
  } catch (err) {
    try {
      await proc.stop('SIGKILL');
    } catch (ign) {}

    _logger.default.errorAndThrow(`Cannot start performance monitoring for '${profileName}' profile in ${START_TIMEOUT_MS}ms. ` + `Make sure you can execute it manually.`);
  }

  RECORDERS_CACHE[profileName] = Object.assign({}, RECORDERS_CACHE[profileName] || {}, {
    [this.opts.device.udid]: {
      proc,
      localPath
    }
  });
};

commands.mobileStopPerfRecord = async function mobileStopPerfRecord(opts = {}) {
  if (!this.relaxedSecurityEnabled && !this.isRealDevice()) {
    _logger.default.errorAndThrow(`Appium server must have relaxed security flag set in order ` + `for Simulator performance measurement to work`);
  }

  const {
    remotePath,
    user,
    pass,
    method,
    profileName = DEFAULT_PROFILE_NAME
  } = opts;
  const runningRecorders = RECORDERS_CACHE[profileName];

  if (!_lodash.default.isPlainObject(runningRecorders) || !runningRecorders[this.opts.device.udid]) {
    _logger.default.errorAndThrow(`There are no records for performance profile '${profileName}' ` + `and device ${this.opts.device.udid}. ` + `Have you started the profiling before?`);
  }

  const {
    proc,
    localPath
  } = runningRecorders[this.opts.device.udid];
  await finishPerfRecord(proc, true);

  if (!(await _appiumSupport.fs.exists(localPath))) {
    _logger.default.errorAndThrow(`There is no .trace file found for performance profile '${profileName}' ` + `and device ${this.opts.device.udid}. ` + `Make sure the profile is supported on this device. ` + `You can use 'instruments -s' command to see the list of all available profiles.`);
  }

  const zipPath = `${localPath}.zip`;
  const zipArgs = ['-9', '-r', zipPath, _path.default.basename(localPath)];

  _logger.default.info(`Found perf trace record '${localPath}'. Compressing it with 'zip ${zipArgs.join(' ')}'`);

  try {
    await (0, _teen_process.exec)('zip', zipArgs, {
      cwd: _path.default.dirname(localPath)
    });
    return await uploadTrace(zipPath, remotePath, {
      user,
      pass,
      method
    });
  } finally {
    delete runningRecorders[this.opts.device.udid];

    if (await _appiumSupport.fs.exists(localPath)) {
      await _appiumSupport.fs.rimraf(localPath);
    }
  }
};

var _default = commands;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9jb21tYW5kcy9wZXJmb3JtYW5jZS5qcyJdLCJuYW1lcyI6WyJjb21tYW5kcyIsIlJFQ09SREVSU19DQUNIRSIsIkRFRkFVTFRfVElNRU9VVF9NUyIsIlNUT1BfVElNRU9VVF9NUyIsIlNUQVJUX1RJTUVPVVRfTVMiLCJERUZBVUxUX1BST0ZJTEVfTkFNRSIsIkRFRkFVTFRfRVhUIiwiZmluaXNoUGVyZlJlY29yZCIsInByb2MiLCJzdG9wR3JhY2VmdWxseSIsImlzUnVubmluZyIsImxvZyIsImRlYnVnIiwic3RvcCIsInVwbG9hZFRyYWNlIiwibG9jYWxGaWxlIiwicmVtb3RlUGF0aCIsInVwbG9hZE9wdGlvbnMiLCJmcyIsInJpbXJhZiIsIm1vYmlsZVN0YXJ0UGVyZlJlY29yZCIsIm9wdHMiLCJyZWxheGVkU2VjdXJpdHlFbmFibGVkIiwiaXNSZWFsRGV2aWNlIiwiZXJyb3JBbmRUaHJvdyIsInRpbWVvdXQiLCJwcm9maWxlTmFtZSIsInBpZCIsInJ1bm5pbmdSZWNvcmRlcnMiLCJfIiwiaXNQbGFpbk9iamVjdCIsImRldmljZSIsInVkaWQiLCJsb2NhbFBhdGgiLCJleGlzdHMiLCJ3aGljaCIsInRlbXBEaXIiLCJwYXRoIiwicHJlZml4IiwiRGF0ZSIsIm5vdyIsInJlcGxhY2UiLCJzdWZmaXgiLCJhcmdzIiwidG9Mb3dlckNhc2UiLCJhcHBJbmZvIiwicHJveHlDb21tYW5kIiwicHVzaCIsIlN1YlByb2Nlc3MiLCJpbmZvIiwiam9pbiIsIm9uIiwiY29kZSIsIm1zZyIsIndhcm4iLCJzdGRvdXQiLCJzdGRlcnIiLCJzcGxpdCIsImZpbHRlciIsIngiLCJsZW5ndGgiLCJtYXAiLCJzdGFydCIsIndhaXRNcyIsImludGVydmFsTXMiLCJlcnIiLCJpZ24iLCJPYmplY3QiLCJhc3NpZ24iLCJtb2JpbGVTdG9wUGVyZlJlY29yZCIsInVzZXIiLCJwYXNzIiwibWV0aG9kIiwiemlwUGF0aCIsInppcEFyZ3MiLCJiYXNlbmFtZSIsImN3ZCIsImRpcm5h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QUNBLFFBQU15QyxPQUFPLEdBQUcsQ0FDZCxJQURjLEVBQ1IsSUFEUSxFQUNGRCxPQURFLEVBRWRwQyxjQUFLc0MsUUFBTCxDQUFjMUMsU0FBZCxDQUZjLENBQWhCOztBQUlBdEIsa0JBQUlzQyxJQUFKLENBQVUsNEJBQTJCaEIsU0FBVSwrQkFBOEJ5QyxPQUFPLENBQUN4QixJQUFSLENBQWEsR0FBYixDQUFrQixHQUEvRjs7QUFDQSxNQUFJO0FBQ0YsVUFBTSx3QkFBSyxLQUFMLEVBQVl3QixPQUFaLEVBQXFCO0FBQ3pCRSxNQUFBQSxHQUFHLEVBQUV2QyxjQUFLd0MsT0FBTCxDQUFhNUMsU0FBYjtBQURvQixLQUFyQixDQUFOO0FBR0EsV0FBTyxNQUFNbkIsV0FBVyxDQUFDMkQsT0FBRCxFQUFVekQsVUFBVixFQUFzQjtBQUFDc0QsTUFBQUEsSUFBRDtBQUFPQyxNQUFBQSxJQUFQO0FBQWFDLE1BQUFBO0FBQWIsS0FBdEIsQ0FBeEI7QUFDRCxHQUxELFNBS1U7QUFDUixXQUFPNUMsZ0JBQWdCLENBQUMsS0FBS1AsSUFBTCxDQUFVVSxNQUFWLENBQWlCQyxJQUFsQixDQUF2Qjs7QUFDQSxRQUFJLE1BQU1kLGtCQUFHZ0IsTUFBSCxDQUFVRCxTQUFWLENBQVYsRUFBZ0M7QUFDOUIsWUFBTWYsa0JBQUdDLE1BQUgsQ0FBVWMsU0FBVixDQUFOO0FBQ0Q7QUFDRjtBQUNGLENBOUNEOztlQWtEZWpDLFEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBmcywgdGVtcERpciB9IGZyb20gJ2FwcGl1bS1zdXBwb3J0JztcbmltcG9ydCB7IFN1YlByb2Nlc3MsIGV4ZWMgfSBmcm9tICd0ZWVuX3Byb2Nlc3MnO1xuaW1wb3J0IGxvZyBmcm9tICcuLi9sb2dnZXInO1xuaW1wb3J0IHsgZW5jb2RlQmFzZTY0T3JVcGxvYWQgfSBmcm9tICcuLi91dGlscyc7XG5pbXBvcnQgeyB3YWl0Rm9yQ29uZGl0aW9uIH0gZnJvbSAnYXN5bmNib3gnO1xuXG5cbmxldCBjb21tYW5kcyA9IHt9O1xuXG5jb25zdCBSRUNPUkRFUlNfQ0FDSEUgPSB7fTtcbmNvbnN0IERFRkFVTFRfVElNRU9VVF9NUyA9IDUgKiA2MCAqIDEwMDA7XG5jb25zdCBTVE9QX1RJTUVPVVRfTVMgPSAzICogNjAgKiAxMDAwO1xuY29uc3QgU1RBUlRfVElNRU9VVF9NUyA9IDE1ICogMTAwMDtcbmNvbnN0IERFRkFVTFRfUFJPRklMRV9OQU1FID0gJ0FjdGl2aXR5IE1vbml0b3InO1xuY29uc3QgREVGQVVMVF9FWFQgPSAnLnRyYWNlJztcblxuXG5hc3luYyBmdW5jdGlvbiBmaW5pc2hQZXJmUmVjb3JkIChwcm9jLCBzdG9wR3JhY2VmdWxseSA9IHRydWUpIHtcbiAgaWYgKCFwcm9jLmlzUnVubmluZykge1xuICAgIHJldHVybjtcbiAgfVxuICBpZiAoc3RvcEdyYWNlZnVsbHkpIHtcbiAgICBsb2cuZGVidWcoYFNlbmRpbmcgU0lHSU5UIHRvIHRoZSBydW5uaW5nIGluc3RydW1lbnRzIHByb2Nlc3NgKTtcbiAgICByZXR1cm4gYXdhaXQgcHJvYy5zdG9wKCdTSUdJTlQnLCBTVE9QX1RJTUVPVVRfTVMpO1xuICB9XG4gIGxvZy5kZWJ1ZyhgU2VuZGluZyBTSUdURVJNIHRvIHRoZSBydW5uaW5nIGluc3RydW1lbnRzIHByb2Nlc3NgKTtcbiAgYXdhaXQgcHJvYy5zdG9wKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVwbG9hZFRyYWNlIChsb2NhbEZpbGUsIHJlbW90ZVBhdGggPSBudWxsLCB1cGxvYWRPcHRpb25zID0ge30pIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gYXdhaXQgZW5jb2RlQmFzZTY0T3JVcGxvYWQobG9jYWxGaWxlLCByZW1vdGVQYXRoLCB1cGxvYWRPcHRpb25zKTtcbiAgfSBmaW5hbGx5IHtcbiAgICBhd2FpdCBmcy5yaW1yYWYobG9jYWxGaWxlKTtcbiAgfVxufVxuXG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gU3RhcnRQZXJmUmVjb3JkT3B0aW9uc1xuICpcbiAqIEBwcm9wZXJ0eSB7P251bWJlcnxzdHJpbmd9IHRpbWVvdXQgWzMwMDAwMF0gLSBUaGUgbWF4aW11bSBjb3VudCBvZiBtaWxsaXNlY29uZHMgdG8gcmVjb3JkIHRoZSBwcm9maWxpbmcgaW5mb3JtYXRpb24uXG4gKiBAcHJvcGVydHkgez9zdHJpbmd9IHByb2ZpbGVOYW1lIFtBY3Rpdml0eSBNb25pdG9yXSAtIFRoZSBuYW1lIG9mIGV4aXN0aW5nIHBlcmZvcm1hbmNlIHByb2ZpbGUgdG8gYXBwbHkuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEV4ZWN1dGUgYGluc3RydW1lbnRzIC1zYCB0byBzaG93IHRoZSBsaXN0IG9mIGF2YWlsYWJsZSBwcm9maWxlcy5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgTm90ZSwgdGhhdCBub3QgYWxsIHByb2ZpbGVzIGFyZSBzdXBwb3J0ZWQgb24gbW9iaWxlIGRldmljZXMuXG4gKiBAcHJvcGVydHkgez9zdHJpbmd8bnVtYmVyfSBwaWQgLSBUaGUgSUQgb2YgdGhlIHByb2Nlc3MgdG8gbWVhc3N1cmUgdGhlIHBlcmZvcm1hbmNlIGZvci5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNldCBpdCB0byBgY3VycmVudGAgaW4gb3JkZXIgdG8gbWVhc3N1cmUgdGhlIHBlcmZvcm1hbmNlIG9mXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgcHJvY2Vzcywgd2hpY2ggYmVsb25ncyB0byB0aGUgY3VycmVudGx5IGFjdGl2ZSBhcHBsaWNhdGlvbi5cbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFsbCBwcm9jZXNzZXMgcnVubmluZyBvbiB0aGUgZGV2aWNlIGFyZSBtZWFzc3VyZWQgaWZcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBpZCBpcyB1bnNldCAodGhlIGRlZmF1bHQgc2V0dGluZykuXG4gKi9cblxuLyoqXG4gKiBTdGFydHMgcGVyZm9ybWFuY2UgcHJvZmlsaW5nIGZvciB0aGUgZGV2aWNlIHVuZGVyIHRlc3QuXG4gKiBUaGUgYGluc3RydW1lbnRzYCBkZXZlbG9wZXIgdXRpbGl0eSBpcyB1c2VkIGZvciB0aGlzIHB1cnBvc2UgdW5kZXIgdGhlIGhvb2QuXG4gKiBJdCBpcyBwb3NzaWJsZSB0byByZWNvcmQgbXVsdGlwbGUgcHJvZmlsZXMgYXQgdGhlIHNhbWUgdGltZS5cbiAqIFJlYWQgaHR0cHM6Ly9kZXZlbG9wZXIuYXBwbGUuY29tL2xpYnJhcnkvY29udGVudC9kb2N1bWVudGF0aW9uL0RldmVsb3BlclRvb2xzL0NvbmNlcHR1YWwvSW5zdHJ1bWVudHNVc2VyR3VpZGUvUmVjb3JkaW5nLFBhdXNpbmcsYW5kU3RvcHBpbmdUcmFjZXMuaHRtbFxuICogZm9yIG1vcmUgZGV0YWlscy5cbiAqXG4gKiBAcGFyYW0gez9TdGFydFBlcmZSZWNvcmRPcHRpb25zfSBvcHRzIC0gVGhlIHNldCBvZiBwb3NzaWJsZSBzdGFydCByZWNvcmQgb3B0aW9uc1xuICovXG5jb21tYW5kcy5tb2JpbGVTdGFydFBlcmZSZWNvcmQgPSBhc3luYyBmdW5jdGlvbiBtb2JpbGVTdGFydFBlcmZSZWNvcmQgKG9wdHMgPSB7fSkge1xuICBpZiAoIXRoaXMucmVsYXhlZFNlY3VyaXR5RW5hYmxlZCAmJiAhdGhpcy5pc1JlYWxEZXZpY2UoKSkge1xuICAgIGxvZy5lcnJvckFuZFRocm93KGBBcHBpdW0gc2VydmVyIG11c3QgaGF2ZSByZWxheGVkIHNlY3VyaXR5IGZsYWcgc2V0IGluIG9yZGVyIGAgK1xuICAgICAgICAgICAgICAgICAgICAgIGBmb3IgU2ltdWxhdG9yIHBlcmZvcm1hbmNlIG1lYXN1cmVtZW50IHRvIHdvcmtgKTtcbiAgfVxuXG4gIGNvbnN0IHtcbiAgICB0aW1lb3V0ID0gREVGQVVMVF9USU1FT1VUX01TLFxuICAgIHByb2ZpbGVOYW1lID0gREVGQVVMVF9QUk9GSUxFX05BTUUsXG4gICAgcGlkLFxuICB9ID0gb3B0cztcblxuICAvLyBDbGVhbnVwIHRoZSBwcm9jZXNzIGlmIGl0IGlzIGFscmVhZHkgcnVubmluZ1xuICBjb25zdCBydW5uaW5nUmVjb3JkZXJzID0gUkVDT1JERVJTX0NBQ0hFW3Byb2ZpbGVOYW1lXTtcbiAgaWYgKF8uaXNQbGFpbk9iamVjdChydW5uaW5nUmVjb3JkZXJzKSAmJiBydW5uaW5nUmVjb3JkZXJzW3RoaXMub3B0cy5kZXZpY2UudWRpZF0pIHtcbiAgICBjb25zdCB7cHJvYywgbG9jYWxQYXRofSA9IHJ1bm5pbmdSZWNvcmRlcnNbdGhpcy5vcHRzLmRldmljZS51ZGlkXTtcbiAgICBhd2FpdCBmaW5pc2hQZXJmUmVjb3JkKHByb2MsIGZhbHNlKTtcbiAgICBpZiAoYXdhaXQgZnMuZXhpc3RzKGxvY2FsUGF0aCkpIHtcbiAgICAgIGF3YWl0IGZzLnJpbXJhZihsb2NhbFBhdGgpO1xuICAgIH1cbiAgICBkZWxldGUgcnVubmluZ1JlY29yZGVyc1t0aGlzLm9wdHMuZGV2aWNlLnVkaWRdO1xuICB9XG5cbiAgaWYgKCFhd2FpdCBmcy53aGljaCgnaW5zdHJ1bWVudHMnKSkge1xuICAgIGxvZy5lcnJvckFuZFRocm93KGBDYW5ub3Qgc3RhcnQgcGVyZm9ybWFuY2UgcmVjb3JkaW5nLCBiZWNhdXNlICdpbnN0cnVtZW50cycgYCArXG4gICAgICAgICAgICAgICAgICAgICAgYHRvb2wgY2Fubm90IGJlIGZvdW5kIGluIFBBVEguIEFyZSBYY29kZSBkZXZlbG9wbWVudCB0b29scyBpbnN0YWxsZWQ/YCk7XG4gIH1cblxuICBjb25zdCBsb2NhbFBhdGggPSBhd2FpdCB0ZW1wRGlyLnBhdGgoe1xuICAgIHByZWZpeDogYGFwcGl1bV9wZXJmXyR7cHJvZmlsZU5hbWV9XyR7RGF0ZS5ub3coKX1gLnJlcGxhY2UoL1xcVy9nLCAnXycpLFxuICAgIHN1ZmZpeDogREVGQVVMVF9FWFQsXG4gIH0pO1xuICBjb25zdCBhcmdzID0gW1xuICAgICctdycsIHRoaXMub3B0cy5kZXZpY2UudWRpZCxcbiAgICAnLXQnLCBwcm9maWxlTmFtZSxcbiAgICAnLUQnLCBsb2NhbFBhdGgsXG4gICAgJy1sJywgdGltZW91dCxcbiAgXTtcbiAgaWYgKHBpZCkge1xuICAgIGlmIChgJHtwaWR9YC50b0xvd2VyQ2FzZSgpID09PSAnY3VycmVudCcpIHtcbiAgICAgIGNvbnN0IGFwcEluZm8gPSBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL3dkYS9hY3RpdmVBcHBJbmZvJywgJ0dFVCcpO1xuICAgICAgYXJncy5wdXNoKCctcCcsIGFwcEluZm8ucGlkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXJncy5wdXNoKCctcCcsIHBpZCk7XG4gICAgfVxuICB9XG4gIGNvbnN0IHByb2MgPSBuZXcgU3ViUHJvY2VzcygnaW5zdHJ1bWVudHMnLCBhcmdzKTtcbiAgbG9nLmluZm8oYFN0YXJ0aW5nICdpbnN0cnVtZW50cycgd2l0aCBhcmd1bWVudHM6ICR7YXJncy5qb2luKCcgJyl9YCk7XG4gIHByb2Mub24oJ2V4aXQnLCAoY29kZSkgPT4ge1xuICAgIGNvbnN0IG1zZyA9IGBpbnN0cnVtZW50cyBleGl0ZWQgd2l0aCBjb2RlICcke2NvZGV9J2A7XG4gICAgaWYgKGNvZGUpIHtcbiAgICAgIGxvZy53YXJuKG1zZyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZy5kZWJ1Zyhtc2cpO1xuICAgIH1cbiAgfSk7XG4gIHByb2Mub24oJ291dHB1dCcsIChzdGRvdXQsIHN0ZGVycikgPT4ge1xuICAgIChzdGRvdXQgfHwgc3RkZXJyKS5zcGxpdCgnXFxuJylcbiAgICAgIC5maWx0ZXIoeCA9PiB4Lmxlbmd0aClcbiAgICAgIC5tYXAoeCA9PiBsb2cuZGVidWcoYFtpbnN0cnVtZW50c10gJHt4fWApKTtcbiAgfSk7XG5cbiAgYXdhaXQgcHJvYy5zdGFydCgwKTtcbiAgdHJ5IHtcbiAgICBhd2FpdCB3YWl0Rm9yQ29uZGl0aW9uKGFzeW5jICgpID0+IGF3YWl0IGZzLmV4aXN0cyhsb2NhbFBhdGgpLCB7XG4gICAgICB3YWl0TXM6IFNUQVJUX1RJTUVPVVRfTVMsXG4gICAgICBpbnRlcnZhbE1zOiA1MDAsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwcm9jLnN0b3AoJ1NJR0tJTEwnKTtcbiAgICB9IGNhdGNoIChpZ24pIHt9XG4gICAgbG9nLmVycm9yQW5kVGhyb3coYENhbm5vdCBzdGFydCBwZXJmb3JtYW5jZSBtb25pdG9yaW5nIGZvciAnJHtwcm9maWxlTmFtZX0nIHByb2ZpbGUgaW4gJHtTVEFSVF9USU1FT1VUX01TfW1zLiBgICtcbiAgICAgICAgICAgICAgICAgICAgICBgTWFrZSBzdXJlIHlvdSBjYW4gZXhlY3V0ZSBpdCBtYW51YWxseS5gKTtcbiAgfVxuICBSRUNPUkRFUlNfQ0FDSEVbcHJvZmlsZU5hbWVdID0gT2JqZWN0LmFzc2lnbih7fSwgKFJFQ09SREVSU19DQUNIRVtwcm9maWxlTmFtZV0gfHwge30pLCB7XG4gICAgW3RoaXMub3B0cy5kZXZpY2UudWRpZF06IHtwcm9jLCBsb2NhbFBhdGh9LFxuICB9KTtcbn07XG5cbi8qKlxuICogQHR5cGVkZWYge09iamVjdH0gU3RvcFJlY29yZGluZ09wdGlvbnNcbiAqXG4gKiBAcHJvcGVydHkgez9zdHJpbmd9IHJlbW90ZVBhdGggLSBUaGUgcGF0aCB0byB0aGUgcmVtb3RlIGxvY2F0aW9uLCB3aGVyZSB0aGUgcmVzdWx0aW5nIHppcHBlZCAudHJhY2UgZmlsZSBzaG91bGQgYmUgdXBsb2FkZWQuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBUaGUgZm9sbG93aW5nIHByb3RvY29scyBhcmUgc3VwcG9ydGVkOiBodHRwL2h0dHBzLCBmdHAuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBOdWxsIG9yIGVtcHR5IHN0cmluZyB2YWx1ZSAodGhlIGRlZmF1bHQgc2V0dGluZykgbWVhbnMgdGhlIGNvbnRlbnQgb2YgcmVzdWx0aW5nXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaWxlIHNob3VsZCBiZSB6aXBwZWQsIGVuY29kZWQgYXMgQmFzZTY0IGFuZCBwYXNzZWQgYXMgdGhlIGVuZHBvdW50IHJlc3BvbnNlIHZhbHVlLlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgQW4gZXhjZXB0aW9uIHdpbGwgYmUgdGhyb3duIGlmIHRoZSBnZW5lcmF0ZWQgZmlsZSBpcyB0b28gYmlnIHRvXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmaXQgaW50byB0aGUgYXZhaWxhYmxlIHByb2Nlc3MgbWVtb3J5LlxuICogQHByb3BlcnR5IHs/c3RyaW5nfSB1c2VyIC0gVGhlIG5hbWUgb2YgdGhlIHVzZXIgZm9yIHRoZSByZW1vdGUgYXV0aGVudGljYXRpb24uIE9ubHkgd29ya3MgaWYgYHJlbW90ZVBhdGhgIGlzIHByb3ZpZGVkLlxuICogQHByb3BlcnR5IHs/c3RyaW5nfSBwYXNzIC0gVGhlIHBhc3N3b3JkIGZvciB0aGUgcmVtb3RlIGF1dGhlbnRpY2F0aW9uLiBPbmx5IHdvcmtzIGlmIGByZW1vdGVQYXRoYCBpcyBwcm92aWRlZC5cbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ30gbWV0aG9kIFtQVVRdIC0gVGhlIGh0dHAgbXVsdGlwYXJ0IHVwbG9hZCBtZXRob2QgbmFtZS4gT25seSB3b3JrcyBpZiBgcmVtb3RlUGF0aGAgaXMgcHJvdmlkZWQuXG4gKiBAcHJvcGVydHkgez9zdHJpbmd9IHByb2ZpbGVOYW1lIFtBY3Rpdml0eSBNb25pdG9yXSAtIFRoZSBuYW1lIG9mIGFuIGV4aXN0aW5nIHBlcmZvcm1hbmNlIHByb2ZpbGUgZm9yIHdoaWNoIHRoZSByZWNvcmRpbmcgaGFzIGJlZW4gbWFkZS5cbiAqL1xuXG4vKipcbiAqIFN0b3BzIHBlcmZvcm1hbmNlIHByb2ZpbGluZyBmb3IgdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICogVGhlIHJlc3VsdGluZyBmaWxlIGluIC50cmFjZSBmb3JtYXQgY2FuIGJlIGVpdGhlciByZXR1cm5lZFxuICogZGlyZWN0bHkgYXMgYmFzZTY0LWVuY29kZWQgemlwIGFyY2hpdmUgb3IgdXBsb2FkZWQgdG8gYSByZW1vdGUgbG9jYXRpb25cbiAqIChzdWNoIGZpbGVzIGNhbiBiZSBwcmV0dHkgbGFyZ2UpLiBBZnRlcndhcmRzIGl0IGlzIHBvc3NpYmxlIHRvIHVuYXJjaGl2ZSBhbmRcbiAqIG9wZW4gc3VjaCBmaWxlIHdpdGggWGNvZGUgRGV2IFRvb2xzLlxuICpcbiAqIEBwYXJhbSB7P1N0b3BSZWNvcmRpbmdPcHRpb25zfSBvcHRzIC0gVGhlIHNldCBvZiBwb3NzaWJsZSBzdG9wIHJlY29yZCBvcHRpb25zXG4gKiBAcmV0dXJuIHtzdHJpbmd9IEVpdGhlciBhbiBlbXB0eSBzdHJpbmcgaWYgdGhlIHVwbG9hZCB3cWFhcyBzdWNjZXNzZnVsIG9yIGJhc2UtNjQgZW5jb2RlZFxuICogY29udGVudCBvZiB6aXBwZWQgLnRyYWNlIGZpbGUuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgbm8gcGVyZm9ybWFuY2UgcmVjb3JkaW5nIHdpdGggZ2l2ZW4gcHJvZmlsZSBuYW1lL2RldmljZSB1ZGlkIGNvbWJpbmF0aW9uXG4gKiBoYXMgYmVlbiBzdGFydGVkIGJlZm9yZSBvciB0aGUgcmVzdWx0aW5nIC50cmFjZSBmaWxlIGhhcyBub3QgYmVlbiBnZW5lcmF0ZWQgcHJvcGVybHkuXG4gKi9cbmNvbW1hbmRzLm1vYmlsZVN0b3BQZXJmUmVjb3JkID0gYXN5bmMgZnVuY3Rpb24gbW9iaWxlU3RvcFBlcmZSZWNvcmQgKG9wdHMgPSB7fSkge1xuICBpZiAoIXRoaXMucmVsYXhlZFNlY3VyaXR5RW5hYmxlZCAmJiAhdGhpcy5pc1JlYWxEZXZpY2UoKSkge1xuICAgIGxvZy5lcnJvckFuZFRocm93KGBBcHBpdW0gc2VydmVyIG11c3QgaGF2ZSByZWxheGVkIHNlY3VyaXR5IGZsYWcgc2V0IGluIG9yZGVyIGAgK1xuICAgICAgICAgICAgICAgICAgICAgIGBmb3IgU2ltdWxhdG9yIHBlcmZvcm1hbmNlIG1lYXN1cmVtZW50IHRvIHdvcmtgKTtcbiAgfVxuXG4gIGNvbnN0IHtcbiAgICByZW1vdGVQYXRoLFxuICAgIHVzZXIsXG4gICAgcGFzcyxcbiAgICBtZXRob2QsXG4gICAgcHJvZmlsZU5hbWUgPSBERUZBVUxUX1BST0ZJTEVfTkFNRSxcbiAgfSA9IG9wdHM7XG4gIGNvbnN0IHJ1bm5pbmdSZWNvcmRlcnMgPSBSRUNPUkRFUlNfQ0FDSEVbcHJvZmlsZU5hbWVdO1xuICBpZiAoIV8uaXNQbGFpbk9iamVjdChydW5uaW5nUmVjb3JkZXJzKSB8fCAhcnVubmluZ1JlY29yZGVyc1t0aGlzLm9wdHMuZGV2aWNlLnVkaWRdKSB7XG4gICAgbG9nLmVycm9yQW5kVGhyb3coYFRoZXJlIGFyZSBubyByZWNvcmRzIGZvciBwZXJmb3JtYW5jZSBwcm9maWxlICcke3Byb2ZpbGVOYW1lfScgYCArXG4gICAgICAgICAgICAgICAgICAgICAgYGFuZCBkZXZpY2UgJHt0aGlzLm9wdHMuZGV2aWNlLnVkaWR9LiBgICtcbiAgICAgICAgICAgICAgICAgICAgICBgSGF2ZSB5b3Ugc3RhcnRlZCB0aGUgcHJvZmlsaW5nIGJlZm9yZT9gKTtcbiAgfVxuXG4gIGNvbnN0IHtwcm9jLCBsb2NhbFBhdGh9ID0gcnVubmluZ1JlY29yZGVyc1t0aGlzLm9wdHMuZGV2aWNlLnVkaWRdO1xuICBhd2FpdCBmaW5pc2hQZXJmUmVjb3JkKHByb2MsIHRydWUpO1xuICBpZiAoIWF3YWl0IGZzLmV4aXN0cyhsb2NhbFBhdGgpKSB7XG4gICAgbG9nLmVycm9yQW5kVGhyb3coYFRoZXJlIGlzIG5vIC50cmFjZSBmaWxlIGZvdW5kIGZvciBwZXJmb3JtYW5jZSBwcm9maWxlICcke3Byb2ZpbGVOYW1lfScgYCArXG4gICAgICAgICAgICAgICAgICAgICAgYGFuZCBkZXZpY2UgJHt0aGlzLm9wdHMuZGV2aWNlLnVkaWR9LiBgICtcbiAgICAgICAgICAgICAgICAgICAgICBgTWFrZSBzdXJlIHRoZSBwcm9maWxlIGlzIHN1cHBvcnRlZCBvbiB0aGlzIGRldmljZS4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgYFlvdSBjYW4gdXNlICdpbnN0cnVtZW50cyAtcycgY29tbWFuZCB0byBzZWUgdGhlIGxpc3Qgb2YgYWxsIGF2YWlsYWJsZSBwcm9maWxlcy5gKTtcbiAgfVxuXG4gIGNvbnN0IHppcFBhdGggPSBgJHtsb2NhbFBhdGh9LnppcGA7XG4gIGNvbnN0IHppcEFyZ3MgPSBbXG4gICAgJy05JywgJy1yJywgemlwUGF0aCxcbiAgICBwYXRoLmJhc2VuYW1lKGxvY2FsUGF0aCksXG4gIF07XG4gIGxvZy5pbmZvKGBGb3VuZCBwZXJmIHRyYWNlIHJlY29yZCAnJHtsb2NhbFBhdGh9Jy4gQ29tcHJlc3NpbmcgaXQgd2l0aCAnemlwICR7emlwQXJncy5qb2luKCcgJyl9J2ApO1xuICB0cnkge1xuICAgIGF3YWl0IGV4ZWMoJ3ppcCcsIHppcEFyZ3MsIHtcbiAgICAgIGN3ZDogcGF0aC5kaXJuYW1lKGxvY2FsUGF0aCksXG4gICAgfSk7XG4gICAgcmV0dXJuIGF3YWl0IHVwbG9hZFRyYWNlKHppcFBhdGgsIHJlbW90ZVBhdGgsIHt1c2VyLCBwYXNzLCBtZXRob2R9KTtcbiAgfSBmaW5hbGx5IHtcbiAgICBkZWxldGUgcnVubmluZ1JlY29yZGVyc1t0aGlzLm9wdHMuZGV2aWNlLnVkaWRdO1xuICAgIGlmIChhd2FpdCBmcy5leGlzdHMobG9jYWxQYXRoKSkge1xuICAgICAgYXdhaXQgZnMucmltcmFmKGxvY2FsUGF0aCk7XG4gICAgfVxuICB9XG59O1xuXG5cbmV4cG9ydCB7IGNvbW1hbmRzIH07XG5leHBvcnQgZGVmYXVsdCBjb21tYW5kcztcbiJdLCJmaWxlIjoibGliL2NvbW1hbmRzL3BlcmZvcm1hbmNlLmpzIiwic291cmNlUm9vdCI6Ii4uLy4uLy4uIn0=
