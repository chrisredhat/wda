"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.detectUdid = detectUdid;
exports.getAndCheckXcodeVersion = getAndCheckXcodeVersion;
exports.getAndCheckIosSdkVersion = getAndCheckIosSdkVersion;
exports.adjustWDAAttachmentsPermissions = adjustWDAAttachmentsPermissions;
exports.checkAppPresent = checkAppPresent;
exports.getDriverInfo = getDriverInfo;
exports.clearSystemFiles = clearSystemFiles;
exports.translateDeviceName = translateDeviceName;
exports.normalizeCommandTimeouts = normalizeCommandTimeouts;
exports.resetXCTestProcesses = resetXCTestProcesses;
exports.getPidUsingPattern = getPidUsingPattern;
exports.markSystemFilesForCleanup = markSystemFilesForCleanup;
exports.printUser = printUser;
exports.printLibimobiledeviceInfo = printLibimobiledeviceInfo;
exports.getPIDsListeningOnPort = getPIDsListeningOnPort;
exports.encodeBase64OrUpload = encodeBase64OrUpload;
exports.removeAllSessionWebSocketHandlers = removeAllSessionWebSocketHandlers;
exports.verifyApplicationPlatform = verifyApplicationPlatform;
exports.isTvOS = isTvOS;
exports.isLocalHost = isLocalHost;
exports.DEFAULT_TIMEOUT_KEY = void 0;

require("source-map-support/register");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _appiumSupport = require("appium-support");

var _path = _interopRequireDefault(require("path"));

var _appiumIosDriver = require("appium-ios-driver");

var _teen_process = require("teen_process");

var _appiumXcode = _interopRequireDefault(require("appium-xcode"));

var _lodash = _interopRequireDefault(require("lodash"));

var _logger = _interopRequireDefault(require("./logger"));

var _fs2 = _interopRequireDefault(require("fs"));

var _url = _interopRequireDefault(require("url"));

var _v = _interopRequireDefault(require("v8"));

var _desiredCaps = require("./desired-caps");

const DEFAULT_TIMEOUT_KEY = 'default';
exports.DEFAULT_TIMEOUT_KEY = DEFAULT_TIMEOUT_KEY;

async function detectUdid() {
  _logger.default.debug('Auto-detecting real device udid...');

  let cmd,
      args = [];

  try {
    cmd = await _appiumSupport.fs.which('idevice_id');
    args.push('-l');

    _logger.default.debug('Using idevice_id');
  } catch (err) {
    _logger.default.debug('Using udidetect');

    cmd = require.resolve('udidetect');
  }

  let udid;

  try {
    let {
      stdout
    } = await (0, _teen_process.exec)(cmd, args, {
      timeout: 3000
    });

    let udids = _lodash.default.uniq(_lodash.default.filter(stdout.split('\n'), Boolean));

    udid = _lodash.default.last(udids);

    if (udids.length > 1) {
      _logger.default.warn(`Multiple devices found: ${udids.join(', ')}`);

      _logger.default.warn(`Choosing '${udid}'. If this is wrong, manually set with 'udid' desired capability`);
    }
  } catch (err) {
    _logger.default.errorAndThrow(`Error detecting udid: ${err.message}`);
  }

  if (!udid || udid.length <= 2) {
    throw new Error('Could not detect udid.');
  }

  _logger.default.debug(`Detected real device udid: '${udid}'`);

  return udid;
}

async function getAndCheckXcodeVersion() {
  let version;

  try {
    version = await _appiumXcode.default.getVersion(true);
  } catch (err) {
    _logger.default.debug(err);

    _logger.default.errorAndThrow(`Could not determine Xcode version: ${err.message}`);
  }

  if (version.versionFloat < 7.3) {
    _logger.default.errorAndThrow(`Xcode version '${version.versionString}'. Support for ` + `Xcode ${version.versionString} is not supported. ` + `Please upgrade to version 7.3 or higher`);
  }

  return version;
}

async function getAndCheckIosSdkVersion() {
  let versionNumber;

  try {
    versionNumber = await _appiumXcode.default.getMaxIOSSDK();
  } catch (err) {
    _logger.default.errorAndThrow(`Could not determine iOS SDK version: ${err.message}`);
  }

  return versionNumber;
}

function translateDeviceName(platformVersion, devName = '') {
  let deviceName = devName;

  switch (devName.toLowerCase().trim()) {
    case 'iphone simulator':
      deviceName = 'iPhone 6';
      break;

    case 'ipad simulator':
      deviceName = platformVersion && _appiumSupport.util.compareVersions(platformVersion, '<', '10.3') ? 'iPad Retina' : 'iPad Air';
      break;
  }

  if (deviceName !== devName) {
    _logger.default.debug(`Changing deviceName from '${devName}' to '${deviceName}'`);
  }

  return deviceName;
}

const derivedDataPermissionsStacks = new Map();

async function adjustWDAAttachmentsPermissions(wda, perms) {
  if (!wda || !(await wda.retrieveDerivedDataPath())) {
    _logger.default.warn('No WebDriverAgent derived data available, so unable to set permissions on WDA attachments folder');

    return;
  }

  const attachmentsFolder = _path.default.join((await wda.retrieveDerivedDataPath()), 'Logs/Test/Attachments');

  const permsStack = derivedDataPermissionsStacks.get(attachmentsFolder) || [];

  if (permsStack.length) {
    if (_lodash.default.last(permsStack) === perms) {
      permsStack.push(perms);

      _logger.default.info(`Not changing permissions of '${attachmentsFolder}' to '${perms}', because they were already set by the other session`);

      return;
    }

    if (permsStack.length > 1) {
      permsStack.pop();

      _logger.default.info(`Not changing permissions of '${attachmentsFolder}' to '${perms}', because the other session does not expect them to be changed`);

      return;
    }
  }

  derivedDataPermissionsStacks.set(attachmentsFolder, [perms]);

  if (await _appiumSupport.fs.exists(attachmentsFolder)) {
    _logger.default.info(`Setting '${perms}' permissions to '${attachmentsFolder}' folder`);

    await _appiumSupport.fs.chmod(attachmentsFolder, perms);
    return;
  }

  _logger.default.info(`There is no ${attachmentsFolder} folder, so not changing permissions`);
}

const derivedDataCleanupMarkers = new Map();

async function markSystemFilesForCleanup(wda) {
  if (!wda || !(await wda.retrieveDerivedDataPath())) {
    _logger.default.warn('No WebDriverAgent derived data available, so unable to mark system files for cleanup');

    return;
  }

  const logsRoot = _path.default.resolve((await wda.retrieveDerivedDataPath()), 'Logs');

  let markersCount = 0;

  if (derivedDataCleanupMarkers.has(logsRoot)) {
    markersCount = derivedDataCleanupMarkers.get(logsRoot);
  }

  derivedDataCleanupMarkers.set(logsRoot, ++markersCount);
}

async function clearSystemFiles(wda) {
  if (!wda || !(await wda.retrieveDerivedDataPath())) {
    _logger.default.warn('No WebDriverAgent derived data available, so unable to clear system files');

    return;
  }

  const logsRoot = _path.default.resolve((await wda.retrieveDerivedDataPath()), 'Logs');

  if (derivedDataCleanupMarkers.has(logsRoot)) {
    let markersCount = derivedDataCleanupMarkers.get(logsRoot);
    derivedDataCleanupMarkers.set(logsRoot, --markersCount);

    if (markersCount > 0) {
      _logger.default.info(`Not cleaning '${logsRoot}' folder, because the other session does not expect it to be cleaned`);

      return;
    }
  }

  derivedDataCleanupMarkers.set(logsRoot, 0);
  const cleanupCmd = `find -E /private/var/folders ` + `-regex '.*/Session-WebDriverAgentRunner.*\\.log$|.*/StandardOutputAndStandardError\\.txt$' ` + `-type f -exec sh -c 'echo "" > "{}"' \\;`;
  const cleanupTask = new _teen_process.SubProcess('bash', ['-c', cleanupCmd], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await cleanupTask.start(0, true);

  _logger.default.debug(`Started background XCTest logs cleanup: ${cleanupCmd}`);

  if (await _appiumSupport.fs.exists(logsRoot)) {
    _logger.default.info(`Cleaning test logs in '${logsRoot}' folder`);

    await _appiumIosDriver.utils.clearLogs([logsRoot]);
    return;
  }

  _logger.default.info(`There is no ${logsRoot} folder, so not cleaning files`);
}

async function checkAppPresent(app) {
  _logger.default.debug(`Checking whether app '${app}' is actually present on file system`);

  if (!(await _appiumSupport.fs.exists(app))) {
    _logger.default.errorAndThrow(`Could not find app at '${app}'`);
  }

  _logger.default.debug('App is present');
}

async function getDriverInfo() {
  const stat = await _appiumSupport.fs.stat(_path.default.resolve(__dirname, '..'));
  const built = stat.mtime.getTime();

  const pkg = require(__filename.includes('build/lib/utils') ? '../../package.json' : '../package.json');

  const version = pkg.version;
  return {
    built,
    version
  };
}

function normalizeCommandTimeouts(value) {
  if (typeof value !== 'string') {
    return value;
  }

  let result = {};

  if (!isNaN(value)) {
    result[DEFAULT_TIMEOUT_KEY] = _lodash.default.toInteger(value);
    return result;
  }

  try {
    result = JSON.parse(value);

    if (!_lodash.default.isPlainObject(result)) {
      throw new Error();
    }
  } catch (err) {
    _logger.default.errorAndThrow(`"commandTimeouts" capability should be a valid JSON object. "${value}" was given instead`);
  }

  for (let [cmd, timeout] of _lodash.default.toPairs(result)) {
    if (!_lodash.default.isInteger(timeout) || timeout <= 0) {
      _logger.default.errorAndThrow(`The timeout for "${cmd}" should be a valid natural number of milliseconds. "${timeout}" was given instead`);
    }
  }

  return result;
}

async function getPidUsingPattern(pgrepPattern) {
  const args = ['-nif', pgrepPattern];

  try {
    const {
      stdout
    } = await (0, _teen_process.exec)('pgrep', args);
    const pid = parseInt(stdout, 10);

    if (isNaN(pid)) {
      _logger.default.debug(`Cannot parse process id from 'pgrep ${args.join(' ')}' output: ${stdout}`);

      return null;
    }

    return `${pid}`;
  } catch (err) {
    _logger.default.debug(`'pgrep ${args.join(' ')}' didn't detect any matching processes. Return code: ${err.code}`);

    return null;
  }
}

async function killAppUsingPattern(pgrepPattern) {
  for (const signal of [2, 15, 9]) {
    if (!(await getPidUsingPattern(pgrepPattern))) {
      return;
    }

    const args = [`-${signal}`, '-if', pgrepPattern];

    try {
      await (0, _teen_process.exec)('pkill', args);
    } catch (err) {
      _logger.default.debug(`pkill ${args.join(' ')} -> ${err.message}`);
    }

    await _bluebird.default.delay(100);
  }
}

async function resetXCTestProcesses(udid, isSimulator, opts = {}) {
  const processPatterns = [`xcodebuild.*${udid}`];

  if (opts.wdaLocalPort) {
    processPatterns.push(`iproxy ${opts.wdaLocalPort}`);
  } else if (!isSimulator) {
    processPatterns.push(`iproxy.*${udid}`);
  }

  if (isSimulator) {
    processPatterns.push(`${udid}.*XCTRunner`);
  }

  _logger.default.debug(`Killing running processes '${processPatterns.join(', ')}' for the device ${udid}...`);

  for (const pgrepPattern of processPatterns) {
    await killAppUsingPattern(pgrepPattern);
  }
}

async function printUser() {
  try {
    let {
      stdout
    } = await (0, _teen_process.exec)('whoami');

    _logger.default.debug(`Current user: '${stdout.trim()}'`);
  } catch (err) {
    _logger.default.debug(`Unable to get username running server: ${err.message}`);
  }
}

async function printLibimobiledeviceInfo() {
  try {
    let {
      stdout
    } = await (0, _teen_process.exec)('brew', ['info', 'libimobiledevice']);
    let match = /libimobiledevice:(.+)/.exec(stdout);

    if (match && match[1]) {
      _logger.default.debug(`Current version of libimobiledevice: ${match[1].trim()}`);
    }
  } catch (err) {
    _logger.default.debug(`Unable to get version of libimobiledevice: ${err.message}`);
  }
}

async function getPIDsListeningOnPort(port, filteringFunc = null) {
  const result = [];

  try {
    const {
      stdout
    } = await (0, _teen_process.exec)('lsof', ['-ti', `tcp:${port}`]);
    result.push(...stdout.trim().split(/\n+/));
  } catch (e) {
    return result;
  }

  if (!_lodash.default.isFunction(filteringFunc)) {
    return result;
  }

  return await _bluebird.default.filter(result, async x => {
    const {
      stdout
    } = await (0, _teen_process.exec)('ps', ['-p', x, '-o', 'command']);
    return await filteringFunc(stdout);
  });
}

async function encodeBase64OrUpload(localFile, remotePath = null, uploadOptions = {}) {
  if (!(await _appiumSupport.fs.exists(localFile))) {
    _logger.default.errorAndThrow(`The file at '${localFile}' does not exist or is not accessible`);
  }

  const {
    size
  } = await _appiumSupport.fs.stat(localFile);

  _logger.default.debug(`The size of the file is ${_appiumSupport.util.toReadableSizeString(size)}`);

  if (_lodash.default.isEmpty(remotePath)) {
    const maxMemoryLimit = _v.default.getHeapStatistics().total_available_size / 2;

    if (size >= maxMemoryLimit) {
      _logger.default.info(`The file might be too large to fit into the process memory ` + `(${_appiumSupport.util.toReadableSizeString(size)} >= ${_appiumSupport.util.toReadableSizeString(maxMemoryLimit)}). ` + `Provide a link to a remote writable location for video upload ` + `(http(s) and ftp protocols are supported) if you experience Out Of Memory errors`);
    }

    const content = await _appiumSupport.fs.readFile(localFile);
    return content.toString('base64');
  }

  const remoteUrl = _url.default.parse(remotePath);

  let options = {};
  const {
    user,
    pass,
    method
  } = uploadOptions;

  if (remoteUrl.protocol.startsWith('http')) {
    options = {
      url: remoteUrl.href,
      method: method || 'PUT',
      multipart: [{
        body: _fs2.default.createReadStream(localFile)
      }]
    };

    if (user && pass) {
      options.auth = {
        user,
        pass
      };
    }
  } else if (remoteUrl.protocol === 'ftp:') {
    options = {
      host: remoteUrl.hostname,
      port: remoteUrl.port || 21
    };

    if (user && pass) {
      options.user = user;
      options.pass = pass;
    }
  }

  await _appiumSupport.net.uploadFile(localFile, remotePath, options);
  return '';
}

async function removeAllSessionWebSocketHandlers(server, sessionId) {
  if (!server || !_lodash.default.isFunction(server.getWebSocketHandlers)) {
    return;
  }

  const activeHandlers = await server.getWebSocketHandlers(sessionId);

  for (const pathname of _lodash.default.keys(activeHandlers)) {
    await server.removeWebSocketHandler(pathname);
  }
}

async function verifyApplicationPlatform(app, isSimulator) {
  _logger.default.debug('Verifying application platform');

  const infoPlist = _path.default.resolve(app, 'Info.plist');

  if (!(await _appiumSupport.fs.exists(infoPlist))) {
    _logger.default.debug(`'${infoPlist}' does not exist`);

    return null;
  }

  const {
    CFBundleSupportedPlatforms
  } = await _appiumSupport.plist.parsePlistFile(infoPlist);

  _logger.default.debug(`CFBundleSupportedPlatforms: ${JSON.stringify(CFBundleSupportedPlatforms)}`);

  if (!_lodash.default.isArray(CFBundleSupportedPlatforms)) {
    _logger.default.debug(`CFBundleSupportedPlatforms key does not exist in '${infoPlist}'`);

    return null;
  }

  const isAppSupported = isSimulator && CFBundleSupportedPlatforms.includes('iPhoneSimulator') || !isSimulator && CFBundleSupportedPlatforms.includes('iPhoneOS');

  if (isAppSupported) {
    return true;
  }

  throw new Error(`${isSimulator ? 'Simulator' : 'Real device'} architecture is unsupported by the '${app}' application. ` + `Make sure the correct deployment target has been selected for its compilation in Xcode.`);
}

function isTvOS(platformName) {
  return _lodash.default.toLower(platformName) === _lodash.default.toLower(_desiredCaps.PLATFORM_NAME_TVOS);
}

function isLocalHost(urlString) {
  try {
    const {
      hostname
    } = _url.default.parse(urlString);

    return ['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(hostname);
  } catch (_unused) {
    _logger.default.warn(`'${urlString}' cannot be parsed as a valid URL`);
  }

  return false;
}require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi91dGlscy5qcyJdLCJuYW1lcyI6WyJERUZBVUxUX1RJTUVPVVRfS0VZIiwiZGV0ZWN0VWRpZCIsImxvZyIsImRlYnVnIiwiY21kIiwiYXJncyIsImZzIiwid2hpY2giLCJwdXNoIiwiZXJyIiwicmVxdWlyZSIsInJlc29sdmUiLCJ1ZGlkIiwic3Rkb3V0IiwidGltZW91dCIsInVkaWRzIiwiXyIsInVuaXEiLCJmaWx0ZXIiLCJzcGxpdCIsIkJvb2xlYW4iLCJsYXN0IiwibGVuZ3RoIiwid2FybiIsImpvaW4iLCJlcnJvckFuZFRocm93IiwibWVzc2FnZSIsIkVycm9yIiwiZ2V0QW5kQ2hlY2tYY29kZVZlcnNpb24iLCJ2ZXJzaW9uIiwieGNvZGUiLCJnZXRWZXJzaW9uIiwidmVyc2lvbkZsb2F0IiwidmVyc2lvblN0cmluZyIsImdldEFuZENoZWNrSW9zU2RrVmVyc2lvbiIsInZlcnNpb25OdW1iZXIiLCJnZXRNYXhJT1NTREsiLCJ0cmFuc2xhdGVEZXZpY2VOYW1lIiwicGxhdGZvcm1WZXJzaW9uIiwiZGV2TmFtZSIsImRldmljZU5hbWUiLCJ0b0xvd2VyQ2FzZSIsInRyaW0iLCJ1dGlsIiwiY29tcGFyZVZlcnNpb25zIiwiZGVyaXZlZERhdGFQZXJtaXNzaW9uc1N0YWNrcyIsIk1hcCIsImFkanVzdFdEQUF0dGFjaG1lbnRzUGVybWlzc2lvbnMiLCJ3ZGEiLCJwZXJtcyIsInJldHJpZXZlRGVyaXZlZERhdGFQYXRoIiwiYXR0YWNobWVudHNGb2xkZXIiLCJwYXRoIiwicGVybXNTdGFjayIsImdldCIsImluZm8iLCJwb3AiLCJzZXQiLCJleGlzdHMiLCJjaG1vZCIsImRlcml2ZWREYXRhQ2xlYW51cE1hcmtlcnMiLCJtYXJrU3lzdGVtRmlsZXNGb3JDbGVhbnVwIiwibG9nc1Jvb3QiLCJtYXJrZXJzQ291bnQiLCJoYXMiLCJjbGVhclN5c3RlbUZpbGVzIiwiY2xlYW51cENtZCIsImNsZWFudXBUYXNrIiwiU3ViUHJvY2VzcyIsImRldGFjaGVkIiwic3RkaW8iLCJzdGFydCIsImlvc1V0aWxzIiwiY2xlYXJMb2dzIiwiY2hlY2tBcHBQcmVzZW50IiwiYXBwIiwiZ2V0RHJpdmVySW5mbyIsInN0YXQiLCJfX2Rpcm5hbWUiLCJidWlsdCIsIm10aW1lIiwiZ2V0VGltZSIsInBrZyIsIl9fZmlsZW5hbWUiLCJpbmNsdWRlcyIsIm5vcm1hbGl6ZUNvbW1hbmRUaW1lb3V0cyIsInZhbHVlIiwicmVzdWx0IiwiaXNOYU4iLCJ0b0ludGVnZXIiLCJKU09OIiwicGFyc2UiLCJpc1BsYWluT2JqZWN0IiwidG9QYWlycyIsImlzSW50ZWdlciIsImdldFBpZFVzaW5nUGF0dGVybiIsInBncmVwUGF0dGVybiIsInBpZCIsInBhcnNlSW50IiwiY29kZSIsImtpbGxBcHBVc2luZ1BhdHRlcm4iLCJzaWduYWwiLCJCIiwiZGVsYXkiLCJyZXNldFhDVGVzdFByb2Nlc3NlcyIsImlzU2ltdWxhdG9yIiwib3B0cyIsInByb2Nlc3NQYXR0ZXJucyIsIndkYUxvY2FsUG9ydCIsInByaW50VXNlciIsInByaW50TGliaW1vYmlsZWRldmljZUluZm8iLCJtYXRjaCIsImV4ZWMiLCJnZXRQSURzTGlzdGVuaW5nT25Qb3J0IiwicG9ydCIsImZpbHRlcmluZ0Z1bmMiLCJlIiwiaXNGdW5jdGlvbiIsIngiLCJlbmNvZGVCYXNlNjRPclVwbG9hZCIsImxvY2FsRmlsZSIsInJlbW90ZVBhdGgiLCJ1cGxvYWRPcHRpb25zIiwic2l6ZSIsInRvUmVhZGFibGVTaXplU3RyaW5nIiwiaXNFbXB0eSIsIm1heE1lbW9yeUxpbWl0IiwidjgiLCJnZXRIZWFwU3RhdGlzdGljcyIsInRvdGFsX2F2YWlsYWJsZV9zaXplIiwiY29udGVudCIsInJlYWRGaWxlIiwidG9TdHJpbmciLCJyZW1vdGVVcmwiLCJ1cmwiLCJvcHRpb25zIiwidXNlciIsInBhc3MiLCJtZXRob2QiLCJwcm90b2NvbCIsInN0YXJ0c1dpdGgiLCJocmVmIiwibXVsdGlwYXJ0IiwiYm9keSIsIl9mcyIsImNyZWF0ZVJlYWRTdHJlYW0iLCJhdXRoIiwiaG9zdCIsImhvc3RuYW1lIiwibmV0IiwidXBsb2FkRmlsZSIsInJlbW92ZUFsbFNlc3Npb25XZWJTb2NrZXRIYW5kbGVycyIsInNlcnZlciIsInNlc3Npb25JZCIsImdldFdlYlNvY2tldEhhbmRsZXJzIiwiYWN0aXZlSGFuZGxlcnMiLCJwYXRobmFtZSIsImtleXMiLCJyZW1vdmVXZWJTb2NrZXRIYW5kbGVyIiwidmVyaWZ5QXBwbGljYXRpb25QbGF0Zm9ybSIsImluZm9QbGlzdCIsIkNGQnVuZGxlU3VwcG9ydGVkUGxhdGZvcm1zIiwicGxpc3QiLCJwYXJzZVBsaXN0RmlsZSIsInN0cmluZ2lmeSIsImlzQXJyYXkiLCJpc0FwcFN1cHBvcnRlZCIsImlzVHZPUyIsInBsYXRmb3JtTmFtZSIsInRvTG93ZXIiLCJQTEFURk9STV9OQU1FX1RWT1MiLCJpc0xvY2FsSG9zdCIsInVybFN0cmluZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVBLE1BQU1BLG1CQUFtQixHQUFHLFNBQTVCOzs7QUFHQSxlQUFlQyxVQUFmLEdBQTZCO0FBQzNCQyxrQkFBSUMsS0FBSixDQUFVLG9DQUFWOztBQUNBLE1BQUlDLEdBQUo7QUFBQSxNQUFTQyxJQUFJLEdBQUcsRUFBaEI7O0FBQ0EsTUFBSTtBQUNGRCxJQUFBQSxHQUFHLEdBQUcsTUFBTUUsa0JBQUdDLEtBQUgsQ0FBUyxZQUFULENBQVo7QUFDQUYsSUFBQUEsSUFBSSxDQUFDRyxJQUFMLENBQVUsSUFBVjs7QUFDQU4sb0JBQUlDLEtBQUosQ0FBVSxrQkFBVjtBQUNELEdBSkQsQ0FJRSxPQUFPTSxHQUFQLEVBQVk7QUFDWlAsb0JBQUlDLEtBQUosQ0FBVSxpQkFBVjs7QUFDQUMsSUFBQUEsR0FBRyxHQUFHTSxPQUFPLENBQUNDLE9BQVIsQ0FBZ0IsV0FBaEIsQ0FBTjtBQUNEOztB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QUFBRCxRQUFhZCxhQUFJM0MsS0FBSixDQUFVaUYsU0FBVixDQUFuQjs7QUFDQSxXQUFPLENBQUMsV0FBRCxFQUFjLFdBQWQsRUFBMkIsS0FBM0IsRUFBa0Msa0JBQWxDLEVBQXNEeEYsUUFBdEQsQ0FBK0RnRSxRQUEvRCxDQUFQO0FBQ0QsR0FIRCxDQUdFLGdCQUFNO0FBQ05sSixvQkFBSXFCLElBQUosQ0FBVSxJQUFHcUosU0FBVSxtQ0FBdkI7QUFDRDs7QUFDRCxTQUFPLEtBQVA7QUFDRCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBCIGZyb20gJ2JsdWViaXJkJztcbmltcG9ydCB7IGZzLCB1dGlsLCBuZXQsIHBsaXN0IH0gZnJvbSAnYXBwaXVtLXN1cHBvcnQnO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyB1dGlscyBhcyBpb3NVdGlscyB9IGZyb20gJ2FwcGl1bS1pb3MtZHJpdmVyJztcbmltcG9ydCB7IFN1YlByb2Nlc3MsIGV4ZWMgfSBmcm9tICd0ZWVuX3Byb2Nlc3MnO1xuaW1wb3J0IHhjb2RlIGZyb20gJ2FwcGl1bS14Y29kZSc7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgX2ZzIGZyb20gJ2ZzJztcbmltcG9ydCB1cmwgZnJvbSAndXJsJztcbmltcG9ydCB2OCBmcm9tICd2OCc7XG5pbXBvcnQgeyBQTEFURk9STV9OQU1FX1RWT1MgfSBmcm9tICcuL2Rlc2lyZWQtY2Fwcyc7XG5cbmNvbnN0IERFRkFVTFRfVElNRU9VVF9LRVkgPSAnZGVmYXVsdCc7XG5cblxuYXN5bmMgZnVuY3Rpb24gZGV0ZWN0VWRpZCAoKSB7XG4gIGxvZy5kZWJ1ZygnQXV0by1kZXRlY3RpbmcgcmVhbCBkZXZpY2UgdWRpZC4uLicpO1xuICBsZXQgY21kLCBhcmdzID0gW107XG4gIHRyeSB7XG4gICAgY21kID0gYXdhaXQgZnMud2hpY2goJ2lkZXZpY2VfaWQnKTtcbiAgICBhcmdzLnB1c2goJy1sJyk7XG4gICAgbG9nLmRlYnVnKCdVc2luZyBpZGV2aWNlX2lkJyk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZy5kZWJ1ZygnVXNpbmcgdWRpZGV0ZWN0Jyk7XG4gICAgY21kID0gcmVxdWlyZS5yZXNvbHZlKCd1ZGlkZXRlY3QnKTtcbiAgfVxuICBsZXQgdWRpZDtcbiAgdHJ5IHtcbiAgICBsZXQge3N0ZG91dH0gPSBhd2FpdCBleGVjKGNtZCwgYXJncywge3RpbWVvdXQ6IDMwMDB9KTtcbiAgICBsZXQgdWRpZHMgPSBfLnVuaXEoXy5maWx0ZXIoc3Rkb3V0LnNwbGl0KCdcXG4nKSwgQm9vbGVhbikpO1xuICAgIHVkaWQgPSBfLmxhc3QodWRpZHMpO1xuICAgIGlmICh1ZGlkcy5sZW5ndGggPiAxKSB7XG4gICAgICBsb2cud2FybihgTXVsdGlwbGUgZGV2aWNlcyBmb3VuZDogJHt1ZGlkcy5qb2luKCcsICcpfWApO1xuICAgICAgbG9nLndhcm4oYENob29zaW5nICcke3VkaWR9Jy4gSWYgdGhpcyBpcyB3cm9uZywgbWFudWFsbHkgc2V0IHdpdGggJ3VkaWQnIGRlc2lyZWQgY2FwYWJpbGl0eWApO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nLmVycm9yQW5kVGhyb3coYEVycm9yIGRldGVjdGluZyB1ZGlkOiAke2Vyci5tZXNzYWdlfWApO1xuICB9XG4gIGlmICghdWRpZCB8fCB1ZGlkLmxlbmd0aCA8PSAyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgZGV0ZWN0IHVkaWQuJyk7XG4gIH1cbiAgbG9nLmRlYnVnKGBEZXRlY3RlZCByZWFsIGRldmljZSB1ZGlkOiAnJHt1ZGlkfSdgKTtcbiAgcmV0dXJuIHVkaWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEFuZENoZWNrWGNvZGVWZXJzaW9uICgpIHtcbiAgbGV0IHZlcnNpb247XG4gIHRyeSB7XG4gICAgdmVyc2lvbiA9IGF3YWl0IHhjb2RlLmdldFZlcnNpb24odHJ1ZSk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZy5kZWJ1ZyhlcnIpO1xuICAgIGxvZy5lcnJvckFuZFRocm93KGBDb3VsZCBub3QgZGV0ZXJtaW5lIFhjb2RlIHZlcnNpb246ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gIH1cblxuICAvLyB3ZSBkbyBub3Qgc3VwcG9ydCBYY29kZXMgPCA3LjMsXG4gIGlmICh2ZXJzaW9uLnZlcnNpb25GbG9hdCA8IDcuMykge1xuICAgIGxvZy5lcnJvckFuZFRocm93KGBYY29kZSB2ZXJzaW9uICcke3ZlcnNpb24udmVyc2lvblN0cmluZ30nLiBTdXBwb3J0IGZvciBgICtcbiAgICAgICAgICAgICAgICAgICAgICBgWGNvZGUgJHt2ZXJzaW9uLnZlcnNpb25TdHJpbmd9IGlzIG5vdCBzdXBwb3J0ZWQuIGAgK1xuICAgICAgICAgICAgICAgICAgICAgIGBQbGVhc2UgdXBncmFkZSB0byB2ZXJzaW9uIDcuMyBvciBoaWdoZXJgKTtcbiAgfVxuICByZXR1cm4gdmVyc2lvbjtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QW5kQ2hlY2tJb3NTZGtWZXJzaW9uICgpIHtcbiAgbGV0IHZlcnNpb25OdW1iZXI7XG4gIHRyeSB7XG4gICAgdmVyc2lvbk51bWJlciA9IGF3YWl0IHhjb2RlLmdldE1heElPU1NESygpO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2cuZXJyb3JBbmRUaHJvdyhgQ291bGQgbm90IGRldGVybWluZSBpT1MgU0RLIHZlcnNpb246ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gIH1cbiAgcmV0dXJuIHZlcnNpb25OdW1iZXI7XG59XG5cbmZ1bmN0aW9uIHRyYW5zbGF0ZURldmljZU5hbWUgKHBsYXRmb3JtVmVyc2lvbiwgZGV2TmFtZSA9ICcnKSB7XG4gIGxldCBkZXZpY2VOYW1lID0gZGV2TmFtZTtcbiAgc3dpdGNoIChkZXZOYW1lLnRvTG93ZXJDYXNlKCkudHJpbSgpKSB7XG4gICAgY2FzZSAnaXBob25lIHNpbXVsYXRvcic6XG4gICAgICBkZXZpY2VOYW1lID0gJ2lQaG9uZSA2JztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2lwYWQgc2ltdWxhdG9yJzpcbiAgICAgIC8vIGlQYWQgUmV0aW5hIGlzIG5vIGxvbmdlciBhdmFpbGFibGUgZm9yIGlvcyAxMC4zXG4gICAgICAvLyAgIHNvIHdlIHBpY2sgYW5vdGhlciBpUGFkIHRvIHVzZSBhcyBkZWZhdWx0XG4gICAgICBkZXZpY2VOYW1lID0gcGxhdGZvcm1WZXJzaW9uICYmIHV0aWwuY29tcGFyZVZlcnNpb25zKHBsYXRmb3JtVmVyc2lvbiwgJzwnLCAnMTAuMycpID8gJ2lQYWQgUmV0aW5hJyA6ICdpUGFkIEFpcic7XG4gICAgICBicmVhaztcbiAgfVxuXG4gIGlmIChkZXZpY2VOYW1lICE9PSBkZXZOYW1lKSB7XG4gICAgbG9nLmRlYnVnKGBDaGFuZ2luZyBkZXZpY2VOYW1lIGZyb20gJyR7ZGV2TmFtZX0nIHRvICcke2RldmljZU5hbWV9J2ApO1xuICB9XG4gIHJldHVybiBkZXZpY2VOYW1lO1xufVxuXG4vLyBUaGlzIG1hcCBjb250YWlucyBkZXJpdmVkIGRhdGEgYXR0YWNobWVudCBmb2xkZXJzIGFzIGtleXNcbi8vIGFuZCB2YWx1ZXMgYXJlIHN0YWNrcyBvZiBwZXJtc3Npb24gbWFza3Ncbi8vIEl0IGlzIHVzZWQgdG8gc3luY2hyb25pemUgcGVybWlzc2lvbnMgY2hhbmdlXG4vLyBvbiBzaGFyZWQgZm9sZGVyc1xuY29uc3QgZGVyaXZlZERhdGFQZXJtaXNzaW9uc1N0YWNrcyA9IG5ldyBNYXAoKTtcblxuYXN5bmMgZnVuY3Rpb24gYWRqdXN0V0RBQXR0YWNobWVudHNQZXJtaXNzaW9ucyAod2RhLCBwZXJtcykge1xuICBpZiAoIXdkYSB8fCAhYXdhaXQgd2RhLnJldHJpZXZlRGVyaXZlZERhdGFQYXRoKCkpIHtcbiAgICBsb2cud2FybignTm8gV2ViRHJpdmVyQWdlbnQgZGVyaXZlZCBkYXRhIGF2YWlsYWJsZSwgc28gdW5hYmxlIHRvIHNldCBwZXJtaXNzaW9ucyBvbiBXREEgYXR0YWNobWVudHMgZm9sZGVyJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgYXR0YWNobWVudHNGb2xkZXIgPSBwYXRoLmpvaW4oYXdhaXQgd2RhLnJldHJpZXZlRGVyaXZlZERhdGFQYXRoKCksICdMb2dzL1Rlc3QvQXR0YWNobWVudHMnKTtcbiAgY29uc3QgcGVybXNTdGFjayA9IGRlcml2ZWREYXRhUGVybWlzc2lvbnNTdGFja3MuZ2V0KGF0dGFjaG1lbnRzRm9sZGVyKSB8fCBbXTtcbiAgaWYgKHBlcm1zU3RhY2subGVuZ3RoKSB7XG4gICAgaWYgKF8ubGFzdChwZXJtc1N0YWNrKSA9PT0gcGVybXMpIHtcbiAgICAgIHBlcm1zU3RhY2sucHVzaChwZXJtcyk7XG4gICAgICBsb2cuaW5mbyhgTm90IGNoYW5naW5nIHBlcm1pc3Npb25zIG9mICcke2F0dGFjaG1lbnRzRm9sZGVyfScgdG8gJyR7cGVybXN9JywgYmVjYXVzZSB0aGV5IHdlcmUgYWxyZWFkeSBzZXQgYnkgdGhlIG90aGVyIHNlc3Npb25gKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHBlcm1zU3RhY2subGVuZ3RoID4gMSkge1xuICAgICAgcGVybXNTdGFjay5wb3AoKTtcbiAgICAgIGxvZy5pbmZvKGBOb3QgY2hhbmdpbmcgcGVybWlzc2lvbnMgb2YgJyR7YXR0YWNobWVudHNGb2xkZXJ9JyB0byAnJHtwZXJtc30nLCBiZWNhdXNlIHRoZSBvdGhlciBzZXNzaW9uIGRvZXMgbm90IGV4cGVjdCB0aGVtIHRvIGJlIGNoYW5nZWRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbiAgZGVyaXZlZERhdGFQZXJtaXNzaW9uc1N0YWNrcy5zZXQoYXR0YWNobWVudHNGb2xkZXIsIFtwZXJtc10pO1xuXG4gIGlmIChhd2FpdCBmcy5leGlzdHMoYXR0YWNobWVudHNGb2xkZXIpKSB7XG4gICAgbG9nLmluZm8oYFNldHRpbmcgJyR7cGVybXN9JyBwZXJtaXNzaW9ucyB0byAnJHthdHRhY2htZW50c0ZvbGRlcn0nIGZvbGRlcmApO1xuICAgIGF3YWl0IGZzLmNobW9kKGF0dGFjaG1lbnRzRm9sZGVyLCBwZXJtcyk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGxvZy5pbmZvKGBUaGVyZSBpcyBubyAke2F0dGFjaG1lbnRzRm9sZGVyfSBmb2xkZXIsIHNvIG5vdCBjaGFuZ2luZyBwZXJtaXNzaW9uc2ApO1xufVxuXG4vLyBUaGlzIG1hcCBjb250YWlucyBkZXJpdmVkIGRhdGEgbG9ncyBmb2xkZXJzIGFzIGtleXNcbi8vIGFuZCB2YWx1ZXMgYXJlIHRoZSBjb3VudCBvZiB0aW1lcyB0aGUgcGFydGljdWxhclxuLy8gZm9sZGVyIGhhcyBiZWVuIHNjaGVkdWxlZCBmb3IgcmVtb3ZhbFxuY29uc3QgZGVyaXZlZERhdGFDbGVhbnVwTWFya2VycyA9IG5ldyBNYXAoKTtcblxuYXN5bmMgZnVuY3Rpb24gbWFya1N5c3RlbUZpbGVzRm9yQ2xlYW51cCAod2RhKSB7XG4gIGlmICghd2RhIHx8ICFhd2FpdCB3ZGEucmV0cmlldmVEZXJpdmVkRGF0YVBhdGgoKSkge1xuICAgIGxvZy53YXJuKCdObyBXZWJEcml2ZXJBZ2VudCBkZXJpdmVkIGRhdGEgYXZhaWxhYmxlLCBzbyB1bmFibGUgdG8gbWFyayBzeXN0ZW0gZmlsZXMgZm9yIGNsZWFudXAnKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBsb2dzUm9vdCA9IHBhdGgucmVzb2x2ZShhd2FpdCB3ZGEucmV0cmlldmVEZXJpdmVkRGF0YVBhdGgoKSwgJ0xvZ3MnKTtcbiAgbGV0IG1hcmtlcnNDb3VudCA9IDA7XG4gIGlmIChkZXJpdmVkRGF0YUNsZWFudXBNYXJrZXJzLmhhcyhsb2dzUm9vdCkpIHtcbiAgICBtYXJrZXJzQ291bnQgPSBkZXJpdmVkRGF0YUNsZWFudXBNYXJrZXJzLmdldChsb2dzUm9vdCk7XG4gIH1cbiAgZGVyaXZlZERhdGFDbGVhbnVwTWFya2Vycy5zZXQobG9nc1Jvb3QsICsrbWFya2Vyc0NvdW50KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2xlYXJTeXN0ZW1GaWxlcyAod2RhKSB7XG4gIC8vIG9ubHkgd2FudCB0byBjbGVhciB0aGUgc3lzdGVtIGZpbGVzIGZvciB0aGUgcGFydGljdWxhciBXREEgeGNvZGUgcnVuXG4gIGlmICghd2RhIHx8ICFhd2FpdCB3ZGEucmV0cmlldmVEZXJpdmVkRGF0YVBhdGgoKSkge1xuICAgIGxvZy53YXJuKCdObyBXZWJEcml2ZXJBZ2VudCBkZXJpdmVkIGRhdGEgYXZhaWxhYmxlLCBzbyB1bmFibGUgdG8gY2xlYXIgc3lzdGVtIGZpbGVzJyk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgbG9nc1Jvb3QgPSBwYXRoLnJlc29sdmUoYXdhaXQgd2RhLnJldHJpZXZlRGVyaXZlZERhdGFQYXRoKCksICdMb2dzJyk7XG4gIGlmIChkZXJpdmVkRGF0YUNsZWFudXBNYXJrZXJzLmhhcyhsb2dzUm9vdCkpIHtcbiAgICBsZXQgbWFya2Vyc0NvdW50ID0gZGVyaXZlZERhdGFDbGVhbnVwTWFya2Vycy5nZXQobG9nc1Jvb3QpO1xuICAgIGRlcml2ZWREYXRhQ2xlYW51cE1hcmtlcnMuc2V0KGxvZ3NSb290LCAtLW1hcmtlcnNDb3VudCk7XG4gICAgaWYgKG1hcmtlcnNDb3VudCA+IDApIHtcbiAgICAgIGxvZy5pbmZvKGBOb3QgY2xlYW5pbmcgJyR7bG9nc1Jvb3R9JyBmb2xkZXIsIGJlY2F1c2UgdGhlIG90aGVyIHNlc3Npb24gZG9lcyBub3QgZXhwZWN0IGl0IHRvIGJlIGNsZWFuZWRgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbiAgZGVyaXZlZERhdGFDbGVhbnVwTWFya2Vycy5zZXQobG9nc1Jvb3QsIDApO1xuXG4gIC8vIENsZWFuaW5nIHVwIGJpZyB0ZW1wb3JhcnkgZmlsZXMgY3JlYXRlZCBieSBYQ1Rlc3Q6IGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vYXBwaXVtL2lzc3Vlcy85NDEwXG4gIGNvbnN0IGNsZWFudXBDbWQgPSBgZmluZCAtRSAvcHJpdmF0ZS92YXIvZm9sZGVycyBgICtcbiAgICBgLXJlZ2V4ICcuKi9TZXNzaW9uLVdlYkRyaXZlckFnZW50UnVubmVyLipcXFxcLmxvZyR8LiovU3RhbmRhcmRPdXRwdXRBbmRTdGFuZGFyZEVycm9yXFxcXC50eHQkJyBgICtcbiAgICBgLXR5cGUgZiAtZXhlYyBzaCAtYyAnZWNobyBcIlwiID4gXCJ7fVwiJyBcXFxcO2A7XG4gIGNvbnN0IGNsZWFudXBUYXNrID0gbmV3IFN1YlByb2Nlc3MoJ2Jhc2gnLCBbJy1jJywgY2xlYW51cENtZF0sIHtcbiAgICBkZXRhY2hlZDogdHJ1ZSxcbiAgICBzdGRpbzogWydpZ25vcmUnLCAncGlwZScsICdwaXBlJ10sXG4gIH0pO1xuICAvLyBEbyBub3Qgd2FpdCBmb3IgdGhlIHRhc2sgdG8gYmUgY29tcGxldGVkLCBzaW5jZSBpdCBtaWdodCB0YWtlIGEgbG90IG9mIHRpbWVcbiAgLy8gV2Uga2VlcCBpdCBydW5uaW5nIGFmdGVyIEFwcGl1bSBwcm9jZXNzIGlzIGtpbGxlZFxuICBhd2FpdCBjbGVhbnVwVGFzay5zdGFydCgwLCB0cnVlKTtcbiAgbG9nLmRlYnVnKGBTdGFydGVkIGJhY2tncm91bmQgWENUZXN0IGxvZ3MgY2xlYW51cDogJHtjbGVhbnVwQ21kfWApO1xuXG4gIGlmIChhd2FpdCBmcy5leGlzdHMobG9nc1Jvb3QpKSB7XG4gICAgbG9nLmluZm8oYENsZWFuaW5nIHRlc3QgbG9ncyBpbiAnJHtsb2dzUm9vdH0nIGZvbGRlcmApO1xuICAgIGF3YWl0IGlvc1V0aWxzLmNsZWFyTG9ncyhbbG9nc1Jvb3RdKTtcbiAgICByZXR1cm47XG4gIH1cbiAgbG9nLmluZm8oYFRoZXJlIGlzIG5vICR7bG9nc1Jvb3R9IGZvbGRlciwgc28gbm90IGNsZWFuaW5nIGZpbGVzYCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrQXBwUHJlc2VudCAoYXBwKSB7XG4gIGxvZy5kZWJ1ZyhgQ2hlY2tpbmcgd2hldGhlciBhcHAgJyR7YXBwfScgaXMgYWN0dWFsbHkgcHJlc2VudCBvbiBmaWxlIHN5c3RlbWApO1xuICBpZiAoIShhd2FpdCBmcy5leGlzdHMoYXBwKSkpIHtcbiAgICBsb2cuZXJyb3JBbmRUaHJvdyhgQ291bGQgbm90IGZpbmQgYXBwIGF0ICcke2FwcH0nYCk7XG4gIH1cbiAgbG9nLmRlYnVnKCdBcHAgaXMgcHJlc2VudCcpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXREcml2ZXJJbmZvICgpIHtcbiAgY29uc3Qgc3RhdCA9IGF3YWl0IGZzLnN0YXQocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uJykpO1xuICBjb25zdCBidWlsdCA9IHN0YXQubXRpbWUuZ2V0VGltZSgpO1xuXG4gIC8vIGdldCB0aGUgcGFja2FnZS5qc29uIGFuZCB0aGUgdmVyc2lvbiBmcm9tIGl0XG4gIGNvbnN0IHBrZyA9IHJlcXVpcmUoX19maWxlbmFtZS5pbmNsdWRlcygnYnVpbGQvbGliL3V0aWxzJykgPyAnLi4vLi4vcGFja2FnZS5qc29uJyA6ICcuLi9wYWNrYWdlLmpzb24nKTtcbiAgY29uc3QgdmVyc2lvbiA9IHBrZy52ZXJzaW9uO1xuXG4gIHJldHVybiB7XG4gICAgYnVpbHQsXG4gICAgdmVyc2lvbixcbiAgfTtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplQ29tbWFuZFRpbWVvdXRzICh2YWx1ZSkge1xuICAvLyBUaGUgdmFsdWUgaXMgbm9ybWFsaXplZCBhbHJlYWR5XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG5cbiAgbGV0IHJlc3VsdCA9IHt9O1xuICAvLyBVc2UgYXMgZGVmYXVsdCB0aW1lb3V0IGZvciBhbGwgY29tbWFuZHMgaWYgYSBzaW5nbGUgaW50ZWdlciB2YWx1ZSBpcyBwcm92aWRlZFxuICBpZiAoIWlzTmFOKHZhbHVlKSkge1xuICAgIHJlc3VsdFtERUZBVUxUX1RJTUVPVVRfS0VZXSA9IF8udG9JbnRlZ2VyKHZhbHVlKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gSlNPTiBvYmplY3QgaGFzIGJlZW4gcHJvdmlkZWQuIExldCdzIHBhcnNlIGl0XG4gIHRyeSB7XG4gICAgcmVzdWx0ID0gSlNPTi5wYXJzZSh2YWx1ZSk7XG4gICAgaWYgKCFfLmlzUGxhaW5PYmplY3QocmVzdWx0KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2cuZXJyb3JBbmRUaHJvdyhgXCJjb21tYW5kVGltZW91dHNcIiBjYXBhYmlsaXR5IHNob3VsZCBiZSBhIHZhbGlkIEpTT04gb2JqZWN0LiBcIiR7dmFsdWV9XCIgd2FzIGdpdmVuIGluc3RlYWRgKTtcbiAgfVxuICBmb3IgKGxldCBbY21kLCB0aW1lb3V0XSBvZiBfLnRvUGFpcnMocmVzdWx0KSkge1xuICAgIGlmICghXy5pc0ludGVnZXIodGltZW91dCkgfHwgdGltZW91dCA8PSAwKSB7XG4gICAgICBsb2cuZXJyb3JBbmRUaHJvdyhgVGhlIHRpbWVvdXQgZm9yIFwiJHtjbWR9XCIgc2hvdWxkIGJlIGEgdmFsaWQgbmF0dXJhbCBudW1iZXIgb2YgbWlsbGlzZWNvbmRzLiBcIiR7dGltZW91dH1cIiB3YXMgZ2l2ZW4gaW5zdGVhZGApO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vKipcbiAqIEdldCB0aGUgcHJvY2VzcyBpZCBvZiB0aGUgbW9zdCByZWNlbnQgcnVubmluZyBhcHBsaWNhdGlvblxuICogaGF2aW5nIHRoZSBwYXJ0aWN1bGFyIGNvbW1hbmQgbGluZSBwYXR0ZXJuLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwZ3JlcFBhdHRlcm4gLSBwZ3JlcC1jb21wYXRpYmxlIHNlYXJjaCBwYXR0ZXJuLlxuICogQHJldHVybiB7c3RyaW5nfSBFaXRoZXIgYSBwcm9jZXNzIGlkIG9yIG51bGwgaWYgbm8gbWF0Y2hlcyB3ZXJlIGZvdW5kLlxuICovXG5hc3luYyBmdW5jdGlvbiBnZXRQaWRVc2luZ1BhdHRlcm4gKHBncmVwUGF0dGVybikge1xuICBjb25zdCBhcmdzID0gWyctbmlmJywgcGdyZXBQYXR0ZXJuXTtcbiAgdHJ5IHtcbiAgICBjb25zdCB7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMoJ3BncmVwJywgYXJncyk7XG4gICAgY29uc3QgcGlkID0gcGFyc2VJbnQoc3Rkb3V0LCAxMCk7XG4gICAgaWYgKGlzTmFOKHBpZCkpIHtcbiAgICAgIGxvZy5kZWJ1ZyhgQ2Fubm90IHBhcnNlIHByb2Nlc3MgaWQgZnJvbSAncGdyZXAgJHthcmdzLmpvaW4oJyAnKX0nIG91dHB1dDogJHtzdGRvdXR9YCk7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgcmV0dXJuIGAke3BpZH1gO1xuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2cuZGVidWcoYCdwZ3JlcCAke2FyZ3Muam9pbignICcpfScgZGlkbid0IGRldGVjdCBhbnkgbWF0Y2hpbmcgcHJvY2Vzc2VzLiBSZXR1cm4gY29kZTogJHtlcnIuY29kZX1gKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG4vKipcbiAqIEtpbGwgYSBwcm9jZXNzIGhhdmluZyB0aGUgcGFydGljdWxhciBjb21tYW5kIGxpbmUgcGF0dGVybi5cbiAqIFRoaXMgbWV0aG9kIHRyaWVzIHRvIHNlbmQgU0lHSU5ULCBTSUdURVJNIGFuZCBTSUdLSUxMIHRvIHRoZVxuICogbWF0Y2hlZCBwcm9jZXNzZXMgaW4gdGhpcyBvcmRlciBpZiB0aGUgcHJvY2VzcyBpcyBzdGlsbCBydW5uaW5nLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBwZ3JlcFBhdHRlcm4gLSBwZ3JlcC1jb21wYXRpYmxlIHNlYXJjaCBwYXR0ZXJuLlxuICovXG5hc3luYyBmdW5jdGlvbiBraWxsQXBwVXNpbmdQYXR0ZXJuIChwZ3JlcFBhdHRlcm4pIHtcbiAgZm9yIChjb25zdCBzaWduYWwgb2YgWzIsIDE1LCA5XSkge1xuICAgIGlmICghYXdhaXQgZ2V0UGlkVXNpbmdQYXR0ZXJuKHBncmVwUGF0dGVybikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgYXJncyA9IFtgLSR7c2lnbmFsfWAsICctaWYnLCBwZ3JlcFBhdHRlcm5dO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBleGVjKCdwa2lsbCcsIGFyZ3MpO1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgbG9nLmRlYnVnKGBwa2lsbCAke2FyZ3Muam9pbignICcpfSAtPiAke2Vyci5tZXNzYWdlfWApO1xuICAgIH1cbiAgICBhd2FpdCBCLmRlbGF5KDEwMCk7XG4gIH1cbn1cblxuLyoqXG4gKiBLaWxscyBydW5uaW5nIFhDVGVzdCBwcm9jZXNzZXMgZm9yIHRoZSBwYXJ0aWN1bGFyIGRldmljZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdWRpZCAtIFRoZSBkZXZpY2UgVURJRC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gaXNTaW11bGF0b3IgLSBFcXVhbHMgdG8gdHJ1ZSBpZiB0aGUgY3VycmVudCBkZXZpY2UgaXMgYSBTaW11bGF0b3JcbiAqIEBwYXJhbSB7b2JqZWN0fSBvcHRzIC0gQWRkaXRpb25hbCBvcHRpb25zIG1hcHBpbmcuIFBvc3NpYmxlIGtleXMgYXJlOlxuICogICAtIHtzdHJpbmd8bnVtYmVyfSB3ZGFMb2NhbFBvcnQ6IFRoZSBudW1iZXIgb2YgbG9jYWwgcG9ydCBXREEgaXMgbGlzdGVuaW5nIG9uLlxuICovXG5hc3luYyBmdW5jdGlvbiByZXNldFhDVGVzdFByb2Nlc3NlcyAodWRpZCwgaXNTaW11bGF0b3IsIG9wdHMgPSB7fSkge1xuICBjb25zdCBwcm9jZXNzUGF0dGVybnMgPSBbYHhjb2RlYnVpbGQuKiR7dWRpZH1gXTtcbiAgaWYgKG9wdHMud2RhTG9jYWxQb3J0KSB7XG4gICAgcHJvY2Vzc1BhdHRlcm5zLnB1c2goYGlwcm94eSAke29wdHMud2RhTG9jYWxQb3J0fWApO1xuICB9IGVsc2UgaWYgKCFpc1NpbXVsYXRvcikge1xuICAgIHByb2Nlc3NQYXR0ZXJucy5wdXNoKGBpcHJveHkuKiR7dWRpZH1gKTtcbiAgfVxuICBpZiAoaXNTaW11bGF0b3IpIHtcbiAgICBwcm9jZXNzUGF0dGVybnMucHVzaChgJHt1ZGlkfS4qWENUUnVubmVyYCk7XG4gIH1cbiAgbG9nLmRlYnVnKGBLaWxsaW5nIHJ1bm5pbmcgcHJvY2Vzc2VzICcke3Byb2Nlc3NQYXR0ZXJucy5qb2luKCcsICcpfScgZm9yIHRoZSBkZXZpY2UgJHt1ZGlkfS4uLmApO1xuICBmb3IgKGNvbnN0IHBncmVwUGF0dGVybiBvZiBwcm9jZXNzUGF0dGVybnMpIHtcbiAgICBhd2FpdCBraWxsQXBwVXNpbmdQYXR0ZXJuKHBncmVwUGF0dGVybik7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJpbnRVc2VyICgpIHtcbiAgdHJ5IHtcbiAgICBsZXQge3N0ZG91dH0gPSBhd2FpdCBleGVjKCd3aG9hbWknKTtcbiAgICBsb2cuZGVidWcoYEN1cnJlbnQgdXNlcjogJyR7c3Rkb3V0LnRyaW0oKX0nYCk7XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGxvZy5kZWJ1ZyhgVW5hYmxlIHRvIGdldCB1c2VybmFtZSBydW5uaW5nIHNlcnZlcjogJHtlcnIubWVzc2FnZX1gKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBwcmludExpYmltb2JpbGVkZXZpY2VJbmZvICgpIHtcbiAgdHJ5IHtcbiAgICBsZXQge3N0ZG91dH0gPSBhd2FpdCBleGVjKCdicmV3JywgWydpbmZvJywgJ2xpYmltb2JpbGVkZXZpY2UnXSk7XG4gICAgbGV0IG1hdGNoID0gL2xpYmltb2JpbGVkZXZpY2U6KC4rKS8uZXhlYyhzdGRvdXQpO1xuICAgIGlmIChtYXRjaCAmJiBtYXRjaFsxXSkge1xuICAgICAgbG9nLmRlYnVnKGBDdXJyZW50IHZlcnNpb24gb2YgbGliaW1vYmlsZWRldmljZTogJHttYXRjaFsxXS50cmltKCl9YCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBsb2cuZGVidWcoYFVuYWJsZSB0byBnZXQgdmVyc2lvbiBvZiBsaWJpbW9iaWxlZGV2aWNlOiAke2Vyci5tZXNzYWdlfWApO1xuICB9XG59XG5cbi8qKlxuICogR2V0IHRoZSBJRHMgb2YgcHJvY2Vzc2VzIGxpc3RlbmluZyBvbiB0aGUgcGFydGljdWxhciBzeXN0ZW0gcG9ydC5cbiAqIEl0IGlzIGFsc28gcG9zc2libGUgdG8gYXBwbHkgYWRkaXRpb25hbCBmaWx0ZXJpbmcgYmFzZWQgb24gdGhlXG4gKiBwcm9jZXNzIGNvbW1hbmQgbGluZS5cbiAqXG4gKiBAcGFyYW0ge3N0cmluZ3xudW1iZXJ9IHBvcnQgLSBUaGUgcG9ydCBudW1iZXIuXG4gKiBAcGFyYW0gez9GdW5jdGlvbn0gZmlsdGVyaW5nRnVuYyAtIE9wdGlvbmFsIGxhbWJkYSBmdW5jdGlvbiwgd2hpY2hcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVjZWl2ZXMgY29tbWFuZCBsaW5lIHN0cmluZyBvZiB0aGUgcGFydGljdWxhciBwcm9jZXNzXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpc3RlbmluZyBvbiBnaXZlbiBwb3J0LCBhbmQgaXMgZXhwZWN0ZWQgdG8gcmV0dXJuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVpdGhlciB0cnVlIG9yIGZhbHNlIHRvIGluY2x1ZGUvZXhjbHVkZSB0aGUgY29ycmVzcG9uZGluZyBQSURcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZnJvbSB0aGUgcmVzdWx0aW5nIGFycmF5LlxuICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gdGhlIGxpc3Qgb2YgbWF0Y2hlZCBwcm9jZXNzIGlkcy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZ2V0UElEc0xpc3RlbmluZ09uUG9ydCAocG9ydCwgZmlsdGVyaW5nRnVuYyA9IG51bGwpIHtcbiAgY29uc3QgcmVzdWx0ID0gW107XG4gIHRyeSB7XG4gICAgLy8gVGhpcyBvbmx5IHdvcmtzIHNpbmNlIE1hYyBPUyBYIEVsIENhcGl0YW5cbiAgICBjb25zdCB7c3Rkb3V0fSA9IGF3YWl0IGV4ZWMoJ2xzb2YnLCBbJy10aScsIGB0Y3A6JHtwb3J0fWBdKTtcbiAgICByZXN1bHQucHVzaCguLi4oc3Rkb3V0LnRyaW0oKS5zcGxpdCgvXFxuKy8pKSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgaWYgKCFfLmlzRnVuY3Rpb24oZmlsdGVyaW5nRnVuYykpIHtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG4gIHJldHVybiBhd2FpdCBCLmZpbHRlcihyZXN1bHQsIGFzeW5jICh4KSA9PiB7XG4gICAgY29uc3Qge3N0ZG91dH0gPSBhd2FpdCBleGVjKCdwcycsIFsnLXAnLCB4LCAnLW8nLCAnY29tbWFuZCddKTtcbiAgICByZXR1cm4gYXdhaXQgZmlsdGVyaW5nRnVuYyhzdGRvdXQpO1xuICB9KTtcbn1cblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBVcGxvYWRPcHRpb25zXG4gKlxuICogQHByb3BlcnR5IHs/c3RyaW5nfSB1c2VyIC0gVGhlIG5hbWUgb2YgdGhlIHVzZXIgZm9yIHRoZSByZW1vdGUgYXV0aGVudGljYXRpb24uIE9ubHkgd29ya3MgaWYgYHJlbW90ZVBhdGhgIGlzIHByb3ZpZGVkLlxuICogQHByb3BlcnR5IHs/c3RyaW5nfSBwYXNzIC0gVGhlIHBhc3N3b3JkIGZvciB0aGUgcmVtb3RlIGF1dGhlbnRpY2F0aW9uLiBPbmx5IHdvcmtzIGlmIGByZW1vdGVQYXRoYCBpcyBwcm92aWRlZC5cbiAqIEBwcm9wZXJ0eSB7P3N0cmluZ30gbWV0aG9kIC0gVGhlIGh0dHAgbXVsdGlwYXJ0IHVwbG9hZCBtZXRob2QgbmFtZS4gVGhlICdQVVQnIG9uZSBpcyB1c2VkIGJ5IGRlZmF1bHQuXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE9ubHkgd29ya3MgaWYgYHJlbW90ZVBhdGhgIGlzIHByb3ZpZGVkLlxuICovXG5cblxuLyoqXG4gKiBFbmNvZGVzIHRoZSBnaXZlbiBsb2NhbCBmaWxlIHRvIGJhc2U2NCBhbmQgcmV0dXJucyB0aGUgcmVzdWx0aW5nIHN0cmluZ1xuICogb3IgdXBsb2FkcyBpdCB0byBhIHJlbW90ZSBzZXJ2ZXIgdXNpbmcgaHR0cC9odHRwcyBvciBmdHAgcHJvdG9jb2xzXG4gKiBpZiBgcmVtb3RlUGF0aGAgaXMgc2V0XG4gKlxuICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsRmlsZSAtIFRoZSBwYXRoIHRvIGFuIGV4aXN0aW5nIGxvY2FsIGZpbGVcbiAqIEBwYXJhbSB7P3N0cmluZ30gcmVtb3RlUGF0aCAtIFRoZSBwYXRoIHRvIHRoZSByZW1vdGUgbG9jYXRpb24sIHdoZXJlXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzIGZpbGUgc2hvdWxkIGJlIHVwbG9hZGVkXG4gKiBAcGFyYW0gez9VcGxvYWRPcHRpb25zfSB1cGxvYWRPcHRpb25zIC0gU2V0IG9mIHVwbG9hZCBvcHRpb25zXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBFaXRoZXIgYW4gZW1wdHkgc3RyaW5nIGlmIHRoZSB1cGxvYWQgd2FzIHN1Y2Nlc3NmdWwgb3JcbiAqIGJhc2U2NC1lbmNvZGVkIGZpbGUgcmVwcmVzZW50YXRpb24gaWYgYHJlbW90ZVBhdGhgIGlzIGZhbHN5XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGVuY29kZUJhc2U2NE9yVXBsb2FkIChsb2NhbEZpbGUsIHJlbW90ZVBhdGggPSBudWxsLCB1cGxvYWRPcHRpb25zID0ge30pIHtcbiAgaWYgKCFhd2FpdCBmcy5leGlzdHMobG9jYWxGaWxlKSkge1xuICAgIGxvZy5lcnJvckFuZFRocm93KGBUaGUgZmlsZSBhdCAnJHtsb2NhbEZpbGV9JyBkb2VzIG5vdCBleGlzdCBvciBpcyBub3QgYWNjZXNzaWJsZWApO1xuICB9XG5cbiAgY29uc3Qge3NpemV9ID0gYXdhaXQgZnMuc3RhdChsb2NhbEZpbGUpO1xuICBsb2cuZGVidWcoYFRoZSBzaXplIG9mIHRoZSBmaWxlIGlzICR7dXRpbC50b1JlYWRhYmxlU2l6ZVN0cmluZyhzaXplKX1gKTtcbiAgaWYgKF8uaXNFbXB0eShyZW1vdGVQYXRoKSkge1xuICAgIGNvbnN0IG1heE1lbW9yeUxpbWl0ID0gdjguZ2V0SGVhcFN0YXRpc3RpY3MoKS50b3RhbF9hdmFpbGFibGVfc2l6ZSAvIDI7XG4gICAgaWYgKHNpemUgPj0gbWF4TWVtb3J5TGltaXQpIHtcbiAgICAgIGxvZy5pbmZvKGBUaGUgZmlsZSBtaWdodCBiZSB0b28gbGFyZ2UgdG8gZml0IGludG8gdGhlIHByb2Nlc3MgbWVtb3J5IGAgK1xuICAgICAgICBgKCR7dXRpbC50b1JlYWRhYmxlU2l6ZVN0cmluZyhzaXplKX0gPj0gJHt1dGlsLnRvUmVhZGFibGVTaXplU3RyaW5nKG1heE1lbW9yeUxpbWl0KX0pLiBgICtcbiAgICAgICAgYFByb3ZpZGUgYSBsaW5rIHRvIGEgcmVtb3RlIHdyaXRhYmxlIGxvY2F0aW9uIGZvciB2aWRlbyB1cGxvYWQgYCArXG4gICAgICAgIGAoaHR0cChzKSBhbmQgZnRwIHByb3RvY29scyBhcmUgc3VwcG9ydGVkKSBpZiB5b3UgZXhwZXJpZW5jZSBPdXQgT2YgTWVtb3J5IGVycm9yc2ApO1xuICAgIH1cbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUobG9jYWxGaWxlKTtcbiAgICByZXR1cm4gY29udGVudC50b1N0cmluZygnYmFzZTY0Jyk7XG4gIH1cblxuICBjb25zdCByZW1vdGVVcmwgPSB1cmwucGFyc2UocmVtb3RlUGF0aCk7XG4gIGxldCBvcHRpb25zID0ge307XG4gIGNvbnN0IHt1c2VyLCBwYXNzLCBtZXRob2R9ID0gdXBsb2FkT3B0aW9ucztcbiAgaWYgKHJlbW90ZVVybC5wcm90b2NvbC5zdGFydHNXaXRoKCdodHRwJykpIHtcbiAgICBvcHRpb25zID0ge1xuICAgICAgdXJsOiByZW1vdGVVcmwuaHJlZixcbiAgICAgIG1ldGhvZDogbWV0aG9kIHx8ICdQVVQnLFxuICAgICAgbXVsdGlwYXJ0OiBbeyBib2R5OiBfZnMuY3JlYXRlUmVhZFN0cmVhbShsb2NhbEZpbGUpIH1dLFxuICAgIH07XG4gICAgaWYgKHVzZXIgJiYgcGFzcykge1xuICAgICAgb3B0aW9ucy5hdXRoID0ge3VzZXIsIHBhc3N9O1xuICAgIH1cbiAgfSBlbHNlIGlmIChyZW1vdGVVcmwucHJvdG9jb2wgPT09ICdmdHA6Jykge1xuICAgIG9wdGlvbnMgPSB7XG4gICAgICBob3N0OiByZW1vdGVVcmwuaG9zdG5hbWUsXG4gICAgICBwb3J0OiByZW1vdGVVcmwucG9ydCB8fCAyMSxcbiAgICB9O1xuICAgIGlmICh1c2VyICYmIHBhc3MpIHtcbiAgICAgIG9wdGlvbnMudXNlciA9IHVzZXI7XG4gICAgICBvcHRpb25zLnBhc3MgPSBwYXNzO1xuICAgIH1cbiAgfVxuICBhd2FpdCBuZXQudXBsb2FkRmlsZShsb2NhbEZpbGUsIHJlbW90ZVBhdGgsIG9wdGlvbnMpO1xuICByZXR1cm4gJyc7XG59XG5cbi8qKlxuICogU3RvcHMgYW5kIHJlbW92ZXMgYWxsIHdlYiBzb2NrZXQgaGFuZGxlcnMgdGhhdCBhcmUgbGlzdGVuaW5nXG4gKiBpbiBzY29wZSBvZiB0aGUgY3VycmVjdCBzZXNzaW9uLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBzZXJ2ZXIgLSBUaGUgaW5zdGFuY2Ugb2YgTm9kZUpzIEhUVFAgc2VydmVyLFxuICogd2hpY2ggaG9zdHMgQXBwaXVtXG4gKiBAcGFyYW0ge3N0cmluZ30gc2Vzc2lvbklkIC0gVGhlIGlkIG9mIHRoZSBjdXJyZW50IHNlc3Npb25cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVtb3ZlQWxsU2Vzc2lvbldlYlNvY2tldEhhbmRsZXJzIChzZXJ2ZXIsIHNlc3Npb25JZCkge1xuICBpZiAoIXNlcnZlciB8fCAhXy5pc0Z1bmN0aW9uKHNlcnZlci5nZXRXZWJTb2NrZXRIYW5kbGVycykpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBhY3RpdmVIYW5kbGVycyA9IGF3YWl0IHNlcnZlci5nZXRXZWJTb2NrZXRIYW5kbGVycyhzZXNzaW9uSWQpO1xuICBmb3IgKGNvbnN0IHBhdGhuYW1lIG9mIF8ua2V5cyhhY3RpdmVIYW5kbGVycykpIHtcbiAgICBhd2FpdCBzZXJ2ZXIucmVtb3ZlV2ViU29ja2V0SGFuZGxlcihwYXRobmFtZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBWZXJpZnkgd2hldGhlciB0aGUgZ2l2ZW4gYXBwbGljYXRpb24gaXMgY29tcGF0aWJsZSB0byB0aGVcbiAqIHBsYXRmb3JtIHdoZXJlIGl0IGlzIGdvaW5nIHRvIGJlIGluc3RhbGxlZCBhbmQgdGVzdGVkLlxuICpcbiAqIEBwYXJhbSB7c3RyaW5nfSBhcHAgLSBUaGUgYWN0dWFsIHBhdGggdG8gdGhlIGFwcGxpY2F0aW9uIGJ1bmRsZVxuICogQHBhcmFtIHtib29sZWFufSBpc1NpbXVsYXRvciAtIFNob3VsZCBiZSBzZXQgdG8gYHRydWVgIGlmIHRoZSB0ZXN0IHdpbGwgYmUgZXhlY3V0ZWQgb24gU2ltdWxhdG9yXG4gKiBAcmV0dXJucyB7P2Jvb2xlYW59IFRoZSBmdW5jdGlvbiByZXR1cm5zIGBudWxsYCBpZiB0aGUgYXBwbGljYXRpb24gZG9lcyBub3QgZXhpc3Qgb3IgdGhlcmUgaXMgbm9cbiAqIGBDRkJ1bmRsZVN1cHBvcnRlZFBsYXRmb3Jtc2Aga2V5IGluIGl0cyBJbmZvLnBsaXN0IG1hbmlmZXN0LlxuICogYHRydWVgIGlzIHJldHVybmVkIGlmIHRoZSBidW5kbGUgYXJjaGl0ZWN0dXJlIG1hdGNoZXMgdGhlIGRldmljZSBhcmNoaXRlY3R1cmUuXG4gKiBAdGhyb3dzIHtFcnJvcn0gSWYgYnVuZGxlIGFyY2hpdGVjdHVyZSBkb2VzIG5vdCBtYXRjaCB0aGUgZGV2aWNlIGFyY2hpdGVjdHVyZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gdmVyaWZ5QXBwbGljYXRpb25QbGF0Zm9ybSAoYXBwLCBpc1NpbXVsYXRvcikge1xuICBsb2cuZGVidWcoJ1ZlcmlmeWluZyBhcHBsaWNhdGlvbiBwbGF0Zm9ybScpO1xuXG4gIGNvbnN0IGluZm9QbGlzdCA9IHBhdGgucmVzb2x2ZShhcHAsICdJbmZvLnBsaXN0Jyk7XG4gIGlmICghYXdhaXQgZnMuZXhpc3RzKGluZm9QbGlzdCkpIHtcbiAgICBsb2cuZGVidWcoYCcke2luZm9QbGlzdH0nIGRvZXMgbm90IGV4aXN0YCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCB7Q0ZCdW5kbGVTdXBwb3J0ZWRQbGF0Zm9ybXN9ID0gYXdhaXQgcGxpc3QucGFyc2VQbGlzdEZpbGUoaW5mb1BsaXN0KTtcbiAgbG9nLmRlYnVnKGBDRkJ1bmRsZVN1cHBvcnRlZFBsYXRmb3JtczogJHtKU09OLnN0cmluZ2lmeShDRkJ1bmRsZVN1cHBvcnRlZFBsYXRmb3Jtcyl9YCk7XG4gIGlmICghXy5pc0FycmF5KENGQnVuZGxlU3VwcG9ydGVkUGxhdGZvcm1zKSkge1xuICAgIGxvZy5kZWJ1ZyhgQ0ZCdW5kbGVTdXBwb3J0ZWRQbGF0Zm9ybXMga2V5IGRvZXMgbm90IGV4aXN0IGluICcke2luZm9QbGlzdH0nYCk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBpc0FwcFN1cHBvcnRlZCA9IChpc1NpbXVsYXRvciAmJiBDRkJ1bmRsZVN1cHBvcnRlZFBsYXRmb3Jtcy5pbmNsdWRlcygnaVBob25lU2ltdWxhdG9yJykpXG4gICAgfHwgKCFpc1NpbXVsYXRvciAmJiBDRkJ1bmRsZVN1cHBvcnRlZFBsYXRmb3Jtcy5pbmNsdWRlcygnaVBob25lT1MnKSk7XG4gIGlmIChpc0FwcFN1cHBvcnRlZCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihgJHtpc1NpbXVsYXRvciA/ICdTaW11bGF0b3InIDogJ1JlYWwgZGV2aWNlJ30gYXJjaGl0ZWN0dXJlIGlzIHVuc3VwcG9ydGVkIGJ5IHRoZSAnJHthcHB9JyBhcHBsaWNhdGlvbi4gYCArXG4gICAgICAgICAgICAgICAgICBgTWFrZSBzdXJlIHRoZSBjb3JyZWN0IGRlcGxveW1lbnQgdGFyZ2V0IGhhcyBiZWVuIHNlbGVjdGVkIGZvciBpdHMgY29tcGlsYXRpb24gaW4gWGNvZGUuYCk7XG59XG5cbi8qKlxuICogUmV0dXJuIHRydWUgaWYgdGhlIHBsYXRmb3JtTmFtZSBpcyB0dk9TXG4gKiBAcGFyYW0ge3N0cmluZ30gcGxhdGZvcm1OYW1lIFRoZSBuYW1lIG9mIHRoZSBwbGF0b3JtXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJuIHRydWUgaWYgdGhlIHBsYXRmb3JtTmFtZSBpcyB0dk9TXG4gKi9cbmZ1bmN0aW9uIGlzVHZPUyAocGxhdGZvcm1OYW1lKSB7XG4gIHJldHVybiBfLnRvTG93ZXIocGxhdGZvcm1OYW1lKSA9PT0gXy50b0xvd2VyKFBMQVRGT1JNX05BTUVfVFZPUyk7XG59XG5cbi8qKlxuICogUmV0dXJucyB0cnVlIGlmIHRoZSB1cmxTdHJpbmcgaXMgbG9jYWxob3N0XG4gKiBAcGFyYW0gez9zdHJpbmd9IHVybFN0cmluZ1xuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybiB0cnVlIGlmIHRoZSB1cmxTdHJpbmcgaXMgbG9jYWxob3N0XG4gKi9cbmZ1bmN0aW9uIGlzTG9jYWxIb3N0ICh1cmxTdHJpbmcpIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB7aG9zdG5hbWV9ID0gdXJsLnBhcnNlKHVybFN0cmluZyk7XG4gICAgcmV0dXJuIFsnbG9jYWxob3N0JywgJzEyNy4wLjAuMScsICc6OjEnLCAnOjpmZmZmOjEyNy4wLjAuMSddLmluY2x1ZGVzKGhvc3RuYW1lKTtcbiAgfSBjYXRjaCB7XG4gICAgbG9nLndhcm4oYCcke3VybFN0cmluZ30nIGNhbm5vdCBiZSBwYXJzZWQgYXMgYSB2YWxpZCBVUkxgKTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbmV4cG9ydCB7IGRldGVjdFVkaWQsIGdldEFuZENoZWNrWGNvZGVWZXJzaW9uLCBnZXRBbmRDaGVja0lvc1Nka1ZlcnNpb24sXG4gIGFkanVzdFdEQUF0dGFjaG1lbnRzUGVybWlzc2lvbnMsIGNoZWNrQXBwUHJlc2VudCwgZ2V0RHJpdmVySW5mbyxcbiAgY2xlYXJTeXN0ZW1GaWxlcywgdHJhbnNsYXRlRGV2aWNlTmFtZSwgbm9ybWFsaXplQ29tbWFuZFRpbWVvdXRzLFxuICBERUZBVUxUX1RJTUVPVVRfS0VZLCByZXNldFhDVGVzdFByb2Nlc3NlcywgZ2V0UGlkVXNpbmdQYXR0ZXJuLFxuICBtYXJrU3lzdGVtRmlsZXNGb3JDbGVhbnVwLCBwcmludFVzZXIsIHByaW50TGliaW1vYmlsZWRldmljZUluZm8sXG4gIGdldFBJRHNMaXN0ZW5pbmdPblBvcnQsIGVuY29kZUJhc2U2NE9yVXBsb2FkLCByZW1vdmVBbGxTZXNzaW9uV2ViU29ja2V0SGFuZGxlcnMsXG4gIHZlcmlmeUFwcGxpY2F0aW9uUGxhdGZvcm0sIGlzVHZPUywgaXNMb2NhbEhvc3QgfTtcbiJdLCJmaWxlIjoibGliL3V0aWxzLmpzIiwic291cmNlUm9vdCI6Ii4uLy4uIn0=
