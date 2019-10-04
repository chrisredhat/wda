"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.XCUITestDriver = exports.default = void 0;

require("source-map-support/register");

var _appiumBaseDriver = require("appium-base-driver");

var _appiumSupport = require("appium-support");

var _lodash = _interopRequireDefault(require("lodash"));

var _url = _interopRequireDefault(require("url"));

var _nodeSimctl = require("node-simctl");

var _webdriveragent = _interopRequireDefault(require("./wda/webdriveragent"));

var _logger = _interopRequireDefault(require("./logger"));

var _simulatorManagement = require("./simulator-management");

var _appiumIosSimulator = require("appium-ios-simulator");

var _asyncbox = require("asyncbox");

var _appiumIosDriver = require("appium-ios-driver");

var _desiredCaps = require("./desired-caps");

var _index = _interopRequireDefault(require("./commands/index"));

var _utils = require("./utils");

var _realDeviceManagement = require("./real-device-management");

var _bluebird = _interopRequireDefault(require("bluebird"));

var _asyncLock = _interopRequireDefault(require("async-lock"));

var _path = _interopRequireDefault(require("path"));

const SAFARI_BUNDLE_ID = 'com.apple.mobilesafari';
const WDA_SIM_STARTUP_RETRIES = 2;
const WDA_REAL_DEV_STARTUP_RETRIES = 1;
const WDA_REAL_DEV_TUTORIAL_URL = 'https://github.com/appium/appium-xcuitest-driver/blob/master/docs/real-device-config.md';
const WDA_STARTUP_RETRY_INTERVAL = 10000;
const DEFAULT_SETTINGS = {
  nativeWebTap: false,
  useJSONSource: false,
  shouldUseCompactResponses: true,
  elementResponseAttributes: 'type,label',
  mjpegServerScreenshotQuality: 25,
  mjpegServerFramerate: 10,
  screenshotQuality: 1
};
const SHARED_RESOURCES_GUARD = new _asyncLock.default();
const NO_PROXY_NATIVE_LIST = [['DELETE', /window/], ['GET', /^\/session\/[^\/]+$/], ['GET', /alert_text/], ['GET', /alert\/[^\/]+/], ['GET', /appium/], ['GET', /attribute/], ['GET', /context/], ['GET', /location/], ['GET', /log/], ['GET', /screenshot/], ['GET', /size/], ['GET', /source/], ['GET', /url/], ['GET', /window/], ['POST', /accept_alert/], ['POST', /actions$/], ['POST', /alert_text/], ['POST', /alert\/[^\/]+/], ['POST', /appium/], ['POST', /appium\/device\/is_locked/], ['POST', /appium\/device\/lock/], ['POST', /appium\/device\/unlock/], ['POST', /back/], ['POST', /clear/], ['POST', /context/], ['POST', /dismiss_alert/], ['POST', /element$/], ['POST', /elements$/], ['POST', /execute/], ['POST', /keys/], ['POST', /log/], ['POST', /moveto/], ['POST', /receive_async_response/], ['POST', /session\/[^\/]+\/location/], ['POST', /shake/], ['POST', /timeouts/], ['POST', /touch/], ['POST', /url/], ['POST', /value/], ['POST', /window/]];
const NO_PROXY_WEB_LIST = [['DELETE', /cookie/], ['GET', /attribute/], ['GET', /cookie/], ['GET', /element/], ['GET', /text/], ['GET', /title/], ['POST', /clear/], ['POST', /click/], ['POST', /cookie/], ['POST', /element/], ['POST', /forward/], ['POST', /frame/], ['POST', /keys/], ['POST', /refresh/]].concat(NO_PROXY_NATIVE_LIST);
const MEMOIZED_FUNCTIONS = ['getStatusBarHeight', 'getDevicePixelRatio', 'getScreenInfo', 'getSafariIsIphone', 'getSafariIsIphoneX'];

class XCUITestDriver extends _appiumBaseDriver.BaseDriver {
  constructor(opts = {}, shouldValidateCaps = true) {
    super(opts, shouldValidateCaps);
    this.desiredCapConstraints = _desiredCaps.desiredCapConstraints;
    this.locatorStrategies = ['xpath', 'id', 'name', 'class name', '-ios predicate string', '-ios class chain', 'accessibility id'];
    this.webLocatorStrategies = ['link text', 'css selector', 'tag name', 'link text', 'partial link text'];
    this.resetIos();
    this.settings = new _appiumBaseDriver.DeviceSettings(DEFAULT_SETTINGS, this.onSettingsUpdate.bind(this));
    this.logs = {};

    for (const fn of MEMOIZED_FUNCTIONS) {
      this[fn] = _lodash.default.memoize(this[fn]);
    }
  }

  async onSettingsUpdate(key, value) {
    if (key !== 'nativeWebTap') {
      return await this.proxyCommand('/appium/settings', 'POST', {
        settings: {
          [key]: value
        }
      });
    }

    this.opts.nativeWebTap = !!value;
  }

  resetIos() {
    this.opts = this.opts || {};
    this.wda = null;
    this.opts.device = null;
    this.jwpProxyActive = false;
    this.proxyReqRes = null;
    this.jwpProxyAvoid = [];
    this.safari = false;
    this.cachedWdaStatus = null;
    this.curWebFrames = [];
    this.webElementIds = [];
    this._currentUrl = null;
    this.curContext = null;
    this.xcodeVersion = {};
    this.iosSdkVersion = null;
    this.contexts = [];
    this.implicitWaitMs = 0;
    this.asynclibWaitMs = 0;
    this.pageLoadMs = 6000;
    this.landscapeWebCoordsOffset = 0;
  }

  get driverData() {
    return {};
  }

  async getStatus() {
    if (typeof this.driverInfo === 'undefined') {
      this.driverInfo = await (0, _utils.getDriverInfo)();
    }

    let status = {
      build: {
        version: this.driverInfo.version
      }
    };

    if (this.cachedWdaStatus) {
      status.wda = this.cachedWdaStatus;
    }

    return status;
  }

  async createSession(...args) {
    this.lifecycleData = {};

    try {
      let [sessionId, caps] = await super.createSession(...args);
      this.opts.sessionId = sessionId;
      await this.start();
      caps = Object.assign({}, _appiumIosDriver.defaultServerCaps, caps);
      caps.udid = this.opts.udid;

      if (_lodash.default.has(this.opts, 'nativeWebTap')) {
        await this.updateSettings({
          nativeWebTap: this.opts.nativeWebTap
        });
      }

      if (_lodash.default.has(this.opts, 'useJSONSource')) {
        await this.updateSettings({
          useJSONSource: this.opts.useJSONSource
        });
      }

      let wdaSettings = {
        elementResponseAttributes: DEFAULT_SETTINGS.elementResponseAttributes,
        shouldUseCompactResponses: DEFAULT_SETTINGS.shouldUseCompactResponses
      };

      if (_lodash.default.has(this.opts, 'elementResponseAttributes')) {
        wdaSettings.elementResponseAttributes = this.opts.elementResponseAttributes;
      }

      if (_lodash.default.has(this.opts, 'shouldUseCompactResponses')) {
        wdaSettings.shouldUseCompactResponses = this.opts.shouldUseCompactResponses;
      }

      if (_lodash.default.has(this.opts, 'mjpegServerScreenshotQuality')) {
        wdaSettings.mjpegServerScreenshotQuality = this.opts.mjpegServerScreenshotQuality;
      }

      if (_lodash.default.has(this.opts, 'mjpegServerFramerate')) {
        wdaSettings.mjpegServerFramerate = this.opts.mjpegServerFramerate;
      }

      if (_lodash.default.has(this.opts, 'screenshotQuality')) {
        _logger.default.info(`Setting the quality of phone screenshot: '${this.opts.screenshotQuality}'`);

        wdaSettings.screenshotQuality = this.opts.screenshotQuality;
      }

      await this.updateSettings(wdaSettings);

      if (this.opts.mjpegScreenshotUrl) {
        _logger.default.info(`Starting MJPEG stream reading URL: '${this.opts.mjpegScreenshotUrl}'`);

        this.mjpegStream = new _appiumSupport.mjpeg.MJpegStream(this.opts.mjpegScreenshotUrl);
        await this.mjpegStream.start();
      }

      return [sessionId, caps];
    } catch (e) {
      _logger.default.error(e);

      await this.deleteSession();
      throw e;
    }
  }

  async start() {
    this.opts.noReset = !!this.opts.noReset;
    this.opts.fullReset = !!this.opts.fullReset;
    await (0, _utils.printUser)();

    if (this.opts.platformVersion && _appiumSupport.util.compareVersions(this.opts.platformVersion, '<', '9.3')) {
      throw Error(`Platform version must be 9.3 or above. '${this.opts.platformVersion}' is not supported.`);
    }

    const {
      device,
      udid,
      realDevice
    } = await this.determineDevice();

    _logger.default.info(`Determining device to run tests on: udid: '${udid}', real device: ${realDevice}`);

    this.opts.device = device;
    this.opts.udid = udid;
    this.opts.realDevice = realDevice;
    this.opts.iosSdkVersion = null;

    if (_lodash.default.isEmpty(this.xcodeVersion) && (!this.opts.webDriverAgentUrl || !this.opts.realDevice)) {
      this.xcodeVersion = await (0, _utils.getAndCheckXcodeVersion)();
      this.iosSdkVersion = await (0, _utils.getAndCheckIosSdkVersion)();
      this.opts.iosSdkVersion = this.iosSdkVersion;

      _logger.default.info(`iOS SDK Version set to '${this.opts.iosSdkVersion}'`);
    }

    this.logEvent('xcodeDetailsRetrieved');

    if (this.opts.enableAsyncExecuteFromHttps && !this.isRealDevice()) {
      await (0, _simulatorManagement.shutdownSimulator)(this.opts.device);
      await this.startHttpsAsyncServer();
    }

    if (!this.opts.platformVersion) {
      if (this.opts.device && _lodash.default.isFunction(this.opts.device.getPlatformVersion)) {
        this.opts.platformVersion = await this.opts.device.getPlatformVersion();

        _logger.default.info(`No platformVersion specified. Using device version: '${this.opts.platformVersion}'`);
      } else {}
    }

    if ((this.opts.browserName || '').toLowerCase() === 'safari') {
      _logger.default.info('Safari test requested');

      this.safari = true;
      this.opts.app = undefined;
      this.opts.processArguments = this.opts.processArguments || {};
      this.opts.bundleId = SAFARI_BUNDLE_ID;
      this._currentUrl = this.opts.safariInitialUrl || (this.isRealDevice() ? 'http://appium.io' : `http://${this.opts.address}:${this.opts.port}/welcome`);
      this.opts.processArguments.args = ['-u', this._currentUrl];
    } else {
      await this.configureApp();
    }

    this.logEvent('appConfigured');

    if (this.opts.app) {
      await (0, _utils.checkAppPresent)(this.opts.app);
    }

    if (!this.opts.bundleId) {
      this.opts.bundleId = await _appiumIosDriver.appUtils.extractBundleId(this.opts.app);
    }

    await this.runReset();

    const memoizedLogInfo = _lodash.default.memoize(function logInfo() {
      _logger.default.info("'skipLogCapture' is set. Skipping starting logs such as crash, system, safari console and safari network.");
    });

    const startLogCapture = async () => {
      if (this.opts.skipLogCapture) {
        memoizedLogInfo();
        return false;
      }

      const result = await this.startLogCapture();

      if (result) {
        this.logEvent('logCaptureStarted');
      }

      return result;
    };

    const isLogCaptureStarted = await startLogCapture();

    _logger.default.info(`Setting up ${this.isRealDevice() ? 'real device' : 'simulator'}`);

    if (this.isSimulator()) {
      if (this.opts.shutdownOtherSimulators) {
        if (!this.relaxedSecurityEnabled) {
          _logger.default.errorAndThrow(`Appium server must have relaxed security flag set in order ` + `for 'shutdownOtherSimulators' capability to work`);
        }

        await (0, _simulatorManagement.shutdownOtherSimulators)(this.opts.device);
      }

      if (_appiumSupport.util.hasValue(this.opts.reduceMotion)) {
        await this.opts.device.setReduceMotion(this.opts.reduceMotion);
      }

      this.localConfig = await _appiumIosDriver.settings.setLocaleAndPreferences(this.opts.device, this.opts, this.isSafari(), async sim => {
        await (0, _simulatorManagement.shutdownSimulator)(sim);
        await _appiumIosDriver.settings.setLocaleAndPreferences(sim, this.opts, this.isSafari());
      });
      await this.startSim();

      if (this.opts.customSSLCert) {
        if (await (0, _appiumIosSimulator.hasSSLCert)(this.opts.customSSLCert, this.opts.udid)) {
          _logger.default.info(`SSL cert '${_lodash.default.truncate(this.opts.customSSLCert, {
            length: 20
          })}' already installed`);
        } else {
          _logger.default.info(`Installing ssl cert '${_lodash.default.truncate(this.opts.customSSLCert, {
            length: 20
          })}'`);

          await (0, _simulatorManagement.shutdownSimulator)(this.opts.device);
          await (0, _appiumIosSimulator.installSSLCert)(this.opts.customSSLCert, this.opts.udid);

          _logger.default.info(`Restarting Simulator so that SSL certificate installation takes effect`);

          await this.startSim();
          this.logEvent('customCertInstalled');
        }
      }

      this.logEvent('simStarted');

      if (!isLogCaptureStarted) {
        await startLogCapture();
      }
    }

    if (this.opts.app) {
      await this.installAUT();
      this.logEvent('appInstalled');
    }

    if (!this.opts.app && this.opts.bundleId && !this.safari) {
      if (!(await this.opts.device.isAppInstalled(this.opts.bundleId))) {
        _logger.default.errorAndThrow(`App with bundle identifier '${this.opts.bundleId}' unknown`);
      }
    }

    if (this.opts.permissions) {
      if (this.isSimulator()) {
        _logger.default.debug('Setting the requested permissions before WDA is started');

        for (const [bundleId, permissionsMapping] of _lodash.default.toPairs(JSON.parse(this.opts.permissions))) {
          await this.opts.device.setPermissions(bundleId, permissionsMapping);
        }
      } else {
        _logger.default.warn('Setting permissions is only supported on Simulator. ' + 'The "permissions" capability will be ignored.');
      }
    }

    await this.startWda(this.opts.sessionId, realDevice);
    await this.setInitialOrientation(this.opts.orientation);
    this.logEvent('orientationSet');

    if (this.isSafari() && !this.isRealDevice() && _appiumSupport.util.compareVersions(this.opts.platformVersion, '>=', '12.2')) {
      await (0, _nodeSimctl.openUrl)(this.opts.device.udid, this._currentUrl);
    }

    if (this.isRealDevice() && this.opts.startIWDP) {
      try {
        await this.startIWDP();

        _logger.default.debug(`Started ios_webkit_debug proxy server at: ${this.iwdpServer.endpoint}`);
      } catch (err) {
        _logger.default.errorAndThrow(`Could not start ios_webkit_debug_proxy server: ${err.message}`);
      }
    }

    if (this.isSafari() || this.opts.autoWebview) {
      _logger.default.debug('Waiting for initial webview');

      await this.navToInitialWebview();
      this.logEvent('initialWebviewNavigated');
    }

    if (this.isSafari() && this.isRealDevice() && _appiumSupport.util.compareVersions(this.opts.platformVersion, '>=', '12.2')) {
      await this.setUrl(this._currentUrl);
    }

    if (!this.isRealDevice()) {
      if (this.opts.calendarAccessAuthorized) {
        await this.opts.device.enableCalendarAccess(this.opts.bundleId);
      } else if (this.opts.calendarAccessAuthorized === false) {
        await this.opts.device.disableCalendarAccess(this.opts.bundleId);
      }
    }
  }

  async startWda(sessionId, realDevice) {
    this.wda = new _webdriveragent.default(this.xcodeVersion, this.opts);
    await this.wda.cleanupObsoleteProcesses();
    const synchronizationKey = !this.opts.useXctestrunFile && (await this.wda.isSourceFresh()) ? XCUITestDriver.name : _path.default.normalize((await this.wda.retrieveDerivedDataPath()));

    _logger.default.debug(`Starting WebDriverAgent initialization with the synchronization key '${synchronizationKey}'`);

    if (SHARED_RESOURCES_GUARD.isBusy() && !this.opts.derivedDataPath && !this.opts.bootstrapPath) {
      _logger.default.debug(`Consider setting a unique 'derivedDataPath' capability value for each parallel driver instance ` + `to avoid conflicts and speed up the building process`);
    }

    return await SHARED_RESOURCES_GUARD.acquire(synchronizationKey, async () => {
      if (this.opts.useNewWDA) {
        _logger.default.debug(`Capability 'useNewWDA' set to true, so uninstalling WDA before proceeding`);

        await this.wda.quitAndUninstall();
        this.logEvent('wdaUninstalled');
      } else if (!_appiumSupport.util.hasValue(this.wda.webDriverAgentUrl)) {
        await this.wda.setupCaching(this.opts.updatedWDABundleId);
      }

      const quitAndUninstall = async msg => {
        _logger.default.debug(msg);

        if (this.opts.webDriverAgentUrl) {
          _logger.default.debug('Not quitting/uninstalling WebDriverAgent since webDriverAgentUrl capability is provided');

          throw new Error(msg);
        }

        _logger.default.warn('Quitting and uninstalling WebDriverAgent');

        await this.wda.quitAndUninstall();
        throw new Error(msg);
      };

      const startupRetries = this.opts.wdaStartupRetries || (this.isRealDevice() ? WDA_REAL_DEV_STARTUP_RETRIES : WDA_SIM_STARTUP_RETRIES);
      const startupRetryInterval = this.opts.wdaStartupRetryInterval || WDA_STARTUP_RETRY_INTERVAL;

      _logger.default.debug(`Trying to start WebDriverAgent ${startupRetries} times with ${startupRetryInterval}ms interval`);

      if (!_appiumSupport.util.hasValue(this.opts.wdaStartupRetries) && !_appiumSupport.util.hasValue(this.opts.wdaStartupRetryInterval)) {
        _logger.default.debug(`These values can be customized by changing wdaStartupRetries/wdaStartupRetryInterval capabilities`);
      }

      let retryCount = 0;
      await (0, _asyncbox.retryInterval)(startupRetries, startupRetryInterval, async () => {
        this.logEvent('wdaStartAttempted');

        if (retryCount > 0) {
          _logger.default.info(`Retrying WDA startup (${retryCount + 1} of ${startupRetries})`);
        }

        try {
          const retries = this.xcodeVersion.major >= 10 ? 2 : 1;
          this.cachedWdaStatus = await (0, _asyncbox.retry)(retries, this.wda.launch.bind(this.wda), sessionId, realDevice);
        } catch (err) {
          this.logEvent('wdaStartFailed');
          retryCount++;
          let errorMsg = `Unable to launch WebDriverAgent because of xcodebuild failure: ${err.message}`;

          if (this.isRealDevice()) {
            errorMsg += `. Make sure you follow the tutorial at ${WDA_REAL_DEV_TUTORIAL_URL}. ` + `Try to remove the WebDriverAgentRunner application from the device if it is installed ` + `and reboot the device.`;
          }

          await quitAndUninstall(errorMsg);
        }

        this.proxyReqRes = this.wda.proxyReqRes.bind(this.wda);
        this.jwpProxyActive = true;
        let originalStacktrace = null;

        try {
          await (0, _asyncbox.retryInterval)(15, 1000, async () => {
            this.logEvent('wdaSessionAttempted');

            _logger.default.debug('Sending createSession command to WDA');

            try {
              this.cachedWdaStatus = this.cachedWdaStatus || (await this.proxyCommand('/status', 'GET'));
              await this.startWdaSession(this.opts.bundleId, this.opts.processArguments);
            } catch (err) {
              originalStacktrace = err.stack;

              _logger.default.debug(`Failed to create WDA session (${err.message}). Retrying...`);

              throw err;
            }
          });
          this.logEvent('wdaSessionStarted');
        } catch (err) {
          if (originalStacktrace) {
            _logger.default.debug(originalStacktrace);
          }

          let errorMsg = `Unable to start WebDriverAgent session because of xcodebuild failure: ${err.message}`;

          if (this.isRealDevice()) {
            errorMsg += ` Make sure you follow the tutorial at ${WDA_REAL_DEV_TUTORIAL_URL}. ` + `Try to remove the WebDriverAgentRunner application from the device if it is installed ` + `and reboot the device.`;
          }

          await quitAndUninstall(errorMsg);
        }

        if (!_appiumSupport.util.hasValue(this.opts.preventWDAAttachments)) {
          this.opts.preventWDAAttachments = this.xcodeVersion.major < 9;

          if (this.opts.preventWDAAttachments) {
            _logger.default.info('Enabled WDA attachments prevention by default to save the disk space. ' + `Set 'preventWDAAttachments' capability to false if this is an undesired behavior.`);
          }
        }

        if (this.opts.preventWDAAttachments) {
          await (0, _utils.adjustWDAAttachmentsPermissions)(this.wda, this.opts.preventWDAAttachments ? '555' : '755');
          this.logEvent('wdaPermsAdjusted');
        }

        if (this.opts.clearSystemFiles) {
          await (0, _utils.markSystemFilesForCleanup)(this.wda);
        }

        this.wda.fullyStarted = true;
        this.logEvent('wdaStarted');
      });
    });
  }

  async runReset(opts = null) {
    this.logEvent('resetStarted');

    if (this.isRealDevice()) {
      await (0, _realDeviceManagement.runRealDeviceReset)(this.opts.device, opts || this.opts);
    } else {
      await (0, _simulatorManagement.runSimulatorReset)(this.opts.device, opts || this.opts);
    }

    this.logEvent('resetComplete');
  }

  async deleteSession() {
    await (0, _utils.removeAllSessionWebSocketHandlers)(this.server, this.sessionId);
    await this.stop();

    if (this.opts.clearSystemFiles && this.isAppTemporary) {
      await _appiumSupport.fs.rimraf(this.opts.app);
    }

    if (this.wda) {
      const synchronizationKey = _path.default.normalize((await this.wda.retrieveDerivedDataPath()));

      await SHARED_RESOURCES_GUARD.acquire(synchronizationKey, async () => {
        if (this.opts.preventWDAAttachments) {
          await (0, _utils.adjustWDAAttachmentsPermissions)(this.wda, '755');
        }

        if (this.opts.clearSystemFiles) {
          await (0, _utils.clearSystemFiles)(this.wda);
        } else {
          _logger.default.debug('Not clearing log files. Use `clearSystemFiles` capability to turn on.');
        }
      });
    }

    if (this.isWebContext()) {
      _logger.default.debug('In a web session. Removing remote debugger');

      await this.stopRemote();
    }

    if (this.opts.resetOnSessionStartOnly === false) {
      await this.runReset();
    }

    if (this.isSimulator() && !this.opts.noReset && !!this.opts.device) {
      if (this.lifecycleData.createSim) {
        _logger.default.debug(`Deleting simulator created for this run (udid: '${this.opts.udid}')`);

        await (0, _simulatorManagement.shutdownSimulator)(this.opts.device);
        await this.opts.device.delete();
      }
    }

    if (!_lodash.default.isEmpty(this.logs)) {
      await this.logs.syslog.stopCapture();
      this.logs = {};
    }

    if (this.iwdpServer) {
      await this.stopIWDP();
    }

    if (this.opts.enableAsyncExecuteFromHttps && !this.isRealDevice()) {
      await this.stopHttpsAsyncServer();
    }

    if (this.mjpegStream) {
      _logger.default.info('Closing MJPEG stream');

      this.mjpegStream.stop();
    }

    this.resetIos();
    await super.deleteSession();
  }

  async stop() {
    this.jwpProxyActive = false;
    this.proxyReqRes = null;

    if (this.wda && this.wda.fullyStarted) {
      if (this.wda.jwproxy) {
        try {
          await this.proxyCommand(`/session/${this.sessionId}`, 'DELETE');
        } catch (err) {
          _logger.default.debug(`Unable to DELETE session on WDA: '${err.message}'. Continuing shutdown.`);
        }
      }

      if (this.wda && !this.wda.webDriverAgentUrl && this.opts.useNewWDA) {
        await this.wda.quit();
      }
    }
  }

  async executeCommand(cmd, ...args) {
    _logger.default.debug(`Executing command '${cmd}'`);

    if (cmd === 'receiveAsyncResponse') {
      return await this.receiveAsyncResponse(...args);
    }

    if (cmd === 'getStatus') {
      return await this.getStatus();
    }

    return await super.executeCommand(cmd, ...args);
  }

  async configureApp() {
    function appIsPackageOrBundle(app) {
      return /^([a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+)+$/.test(app);
    }

    if (!this.opts.bundleId && appIsPackageOrBundle(this.opts.app)) {
      this.opts.bundleId = this.opts.app;
      this.opts.app = '';
    }

    if (this.opts.bundleId && appIsPackageOrBundle(this.opts.bundleId) && (this.opts.app === '' || appIsPackageOrBundle(this.opts.app))) {
      _logger.default.debug('App is an iOS bundle, will attempt to run as pre-existing');

      return;
    }

    if (this.opts.app && this.opts.app.toLowerCase() === 'settings') {
      this.opts.bundleId = 'com.apple.Preferences';
      this.opts.app = null;
      return;
    } else if (this.opts.app && this.opts.app.toLowerCase() === 'calendar') {
      this.opts.bundleId = 'com.apple.mobilecal';
      this.opts.app = null;
      return;
    }

    const originalAppPath = this.opts.app;

    try {
      this.opts.app = await this.helpers.configureApp(this.opts.app, '.app');
    } catch (err) {
      _logger.default.error(err);

      throw new Error(`Bad app: ${this.opts.app}. App paths need to be absolute or an URL to a compressed file`);
    }

    this.isAppTemporary = this.opts.app && (await _appiumSupport.fs.exists(this.opts.app)) && !(await _appiumSupport.util.isSameDestination(originalAppPath, this.opts.app));
  }

  async determineDevice() {
    this.lifecycleData.createSim = false;
    this.opts.deviceName = (0, _utils.translateDeviceName)(this.opts.platformVersion, this.opts.deviceName);

    if (this.opts.udid) {
      if (this.opts.udid.toLowerCase() === 'auto') {
        try {
          this.opts.udid = await (0, _utils.detectUdid)();
        } catch (err) {
          _logger.default.warn(`Cannot detect any connected real devices. Falling back to Simulator. Original error: ${err.message}`);

          const device = await (0, _simulatorManagement.getExistingSim)(this.opts);

          if (!device) {
            _logger.default.errorAndThrow(`Cannot detect udid for ${this.opts.deviceName} Simulator running iOS ${this.opts.platformVersion}`);
          }

          this.opts.udid = device.udid;
          return {
            device,
            realDevice: false,
            udid: device.udid
          };
        }
      } else {
        const devices = await (0, _realDeviceManagement.getConnectedDevices)();

        _logger.default.debug(`Available devices: ${devices.join(', ')}`);

        if (!devices.includes(this.opts.udid)) {
          if (await (0, _appiumIosSimulator.simExists)(this.opts.udid)) {
            const device = await (0, _appiumIosSimulator.getSimulator)(this.opts.udid);
            return {
              device,
              realDevice: false,
              udid: this.opts.udid
            };
          }

          throw new Error(`Unknown device or simulator UDID: '${this.opts.udid}'`);
        }
      }

      const device = await (0, _realDeviceManagement.getRealDeviceObj)(this.opts.udid);
      return {
        device,
        realDevice: true,
        udid: this.opts.udid
      };
    }

    if (!this.opts.platformVersion && this.iosSdkVersion) {
      _logger.default.info(`No platformVersion specified. Using latest version Xcode supports: '${this.iosSdkVersion}' ` + `This may cause problems if a simulator does not exist for this platform version.`);

      this.opts.platformVersion = this.iosSdkVersion;
    }

    if (this.opts.enforceFreshSimulatorCreation) {
      _logger.default.debug(`New simulator is requested. If this is not wanted, set 'enforceFreshSimulatorCreation' capability to false`);
    } else {
      const device = await (0, _simulatorManagement.getExistingSim)(this.opts);

      if (device) {
        return {
          device,
          realDevice: false,
          udid: device.udid
        };
      }

      _logger.default.info('Simulator udid not provided');
    }

    _logger.default.info('Using desired caps to create a new simulator');

    const device = await this.createSim();
    return {
      device,
      realDevice: false,
      udid: device.udid
    };
  }

  async startSim() {
    const runOpts = {
      scaleFactor: this.opts.scaleFactor,
      connectHardwareKeyboard: !!this.opts.connectHardwareKeyboard,
      isHeadless: !!this.opts.isHeadless,
      devicePreferences: {}
    };

    if (this.opts.SimulatorWindowCenter) {
      runOpts.devicePreferences.SimulatorWindowCenter = this.opts.SimulatorWindowCenter;
    }

    const orientation = _lodash.default.isString(this.opts.orientation) && this.opts.orientation.toUpperCase();

    switch (orientation) {
      case 'LANDSCAPE':
        runOpts.devicePreferences.SimulatorWindowOrientation = 'LandscapeLeft';
        runOpts.devicePreferences.SimulatorWindowRotationAngle = 90;
        break;

      case 'PORTRAIT':
        runOpts.devicePreferences.SimulatorWindowOrientation = 'Portrait';
        runOpts.devicePreferences.SimulatorWindowRotationAngle = 0;
        break;
    }

    await this.opts.device.run(runOpts);
  }

  async createSim() {
    this.lifecycleData.createSim = true;
    const platformName = (0, _utils.isTvOS)(this.opts.platformName) ? _desiredCaps.PLATFORM_NAME_TVOS : _desiredCaps.PLATFORM_NAME_IOS;
    let sim = await (0, _simulatorManagement.createSim)(this.opts, platformName);

    _logger.default.info(`Created simulator with udid '${sim.udid}'.`);

    return sim;
  }

  async launchApp() {
    const APP_LAUNCH_TIMEOUT = 20 * 1000;
    this.logEvent('appLaunchAttempted');
    await (0, _nodeSimctl.launch)(this.opts.device.udid, this.opts.bundleId);

    let checkStatus = async () => {
      let response = await this.proxyCommand('/status', 'GET');
      let currentApp = response.currentApp.bundleID;

      if (currentApp !== this.opts.bundleId) {
        throw new Error(`${this.opts.bundleId} not in foreground. ${currentApp} is in foreground`);
      }
    };

    _logger.default.info(`Waiting for '${this.opts.bundleId}' to be in foreground`);

    let retries = parseInt(APP_LAUNCH_TIMEOUT / 200, 10);
    await (0, _asyncbox.retryInterval)(retries, 200, checkStatus);

    _logger.default.info(`${this.opts.bundleId} is in foreground`);

    this.logEvent('appLaunched');
  }

  async startWdaSession(bundleId, processArguments) {
    let args = processArguments ? processArguments.args || [] : [];

    if (!_lodash.default.isArray(args)) {
      throw new Error(`processArguments.args capability is expected to be an array. ` + `${JSON.stringify(args)} is given instead`);
    }

    let env = processArguments ? processArguments.env || {} : {};

    if (!_lodash.default.isPlainObject(env)) {
      throw new Error(`processArguments.env capability is expected to be a dictionary. ` + `${JSON.stringify(env)} is given instead`);
    }

    let shouldWaitForQuiescence = _appiumSupport.util.hasValue(this.opts.waitForQuiescence) ? this.opts.waitForQuiescence : true;
    let maxTypingFrequency = _appiumSupport.util.hasValue(this.opts.maxTypingFrequency) ? this.opts.maxTypingFrequency : 60;
    let shouldUseSingletonTestManager = _appiumSupport.util.hasValue(this.opts.shouldUseSingletonTestManager) ? this.opts.shouldUseSingletonTestManager : true;
    let shouldUseTestManagerForVisibilityDetection = false;
    let eventloopIdleDelaySec = this.opts.wdaEventloopIdleDelay || 0;

    if (_appiumSupport.util.hasValue(this.opts.simpleIsVisibleCheck)) {
      shouldUseTestManagerForVisibilityDetection = this.opts.simpleIsVisibleCheck;
    }

    if (this.opts.platformVersion && _appiumSupport.util.compareVersions(this.opts.platformVersion, '==', '9.3')) {
      _logger.default.info(`Forcing shouldUseSingletonTestManager capability value to true, because of known XCTest issues under 9.3 platform version`);

      shouldUseTestManagerForVisibilityDetection = true;
    }

    if (_appiumSupport.util.hasValue(this.opts.language)) {
      args.push('-AppleLanguages', `(${this.opts.language})`);
      args.push('-NSLanguages', `(${this.opts.language})`);
    }

    if (_appiumSupport.util.hasValue(this.opts.locale)) {
      args.push('-AppleLocale', this.opts.locale);
    }

    let desired = {
      desiredCapabilities: {
        bundleId,
        arguments: args,
        environment: env,
        eventloopIdleDelaySec,
        shouldWaitForQuiescence,
        shouldUseTestManagerForVisibilityDetection,
        maxTypingFrequency,
        shouldUseSingletonTestManager
      }
    };

    if (_appiumSupport.util.hasValue(this.opts.shouldUseCompactResponses)) {
      desired.desiredCapabilities.shouldUseCompactResponses = this.opts.shouldUseCompactResponses;
    }

    if (_appiumSupport.util.hasValue(this.opts.elementResponseFields)) {
      desired.desiredCapabilities.elementResponseFields = this.opts.elementResponseFields;
    }

    if (this.opts.autoAcceptAlerts) {
      desired.desiredCapabilities.defaultAlertAction = 'accept';
    } else if (this.opts.autoDismissAlerts) {
      desired.desiredCapabilities.defaultAlertAction = 'dismiss';
    }

    await this.proxyCommand('/session', 'POST', desired);
  }

  proxyActive() {
    return this.jwpProxyActive;
  }

  getProxyAvoidList() {
    if (this.isWebview()) {
      return NO_PROXY_WEB_LIST;
    }

    return NO_PROXY_NATIVE_LIST;
  }

  canProxy() {
    return true;
  }

  isSafari() {
    return !!this.safari;
  }

  isRealDevice() {
    return this.opts.realDevice;
  }

  isSimulator() {
    return !this.opts.realDevice;
  }

  isWebview() {
    return this.isSafari() || this.isWebContext();
  }

  validateLocatorStrategy(strategy) {
    super.validateLocatorStrategy(strategy, this.isWebContext());
  }

  validateDesiredCaps(caps) {
    if (!super.validateDesiredCaps(caps)) {
      return false;
    }

    if ((caps.browserName || '').toLowerCase() !== 'safari' && !caps.app && !caps.bundleId) {
      let msg = 'The desired capabilities must include either an app or a bundleId for iOS';

      _logger.default.errorAndThrow(msg);
    }

    if (!_appiumSupport.util.coerceVersion(caps.platformVersion, false)) {
      _logger.default.warn(`'platformVersion' capability ('${caps.platformVersion}') is not a valid version number. ` + `Consider fixing it or be ready to experience an inconsistent driver behavior.`);
    }

    let verifyProcessArgument = processArguments => {
      const {
        args,
        env
      } = processArguments;

      if (!_lodash.default.isNil(args) && !_lodash.default.isArray(args)) {
        _logger.default.errorAndThrow('processArguments.args must be an array of strings');
      }

      if (!_lodash.default.isNil(env) && !_lodash.default.isPlainObject(env)) {
        _logger.default.errorAndThrow('processArguments.env must be an object <key,value> pair {a:b, c:d}');
      }
    };

    if (caps.processArguments) {
      if (_lodash.default.isString(caps.processArguments)) {
        try {
          caps.processArguments = JSON.parse(caps.processArguments);
          verifyProcessArgument(caps.processArguments);
        } catch (err) {
          _logger.default.errorAndThrow(`processArguments must be a json format or an object with format {args : [], env : {a:b, c:d}}. ` + `Both environment and argument can be null. Error: ${err}`);
        }
      } else if (_lodash.default.isPlainObject(caps.processArguments)) {
        verifyProcessArgument(caps.processArguments);
      } else {
        _logger.default.errorAndThrow(`'processArguments must be an object, or a string JSON object with format {args : [], env : {a:b, c:d}}. ` + `Both environment and argument can be null.`);
      }
    }

    if (caps.keychainPath && !caps.keychainPassword || !caps.keychainPath && caps.keychainPassword) {
      _logger.default.errorAndThrow(`If 'keychainPath' is set, 'keychainPassword' must also be set (and vice versa).`);
    }

    this.opts.resetOnSessionStartOnly = !_appiumSupport.util.hasValue(this.opts.resetOnSessionStartOnly) || this.opts.resetOnSessionStartOnly;
    this.opts.useNewWDA = _appiumSupport.util.hasValue(this.opts.useNewWDA) ? this.opts.useNewWDA : false;

    if (caps.commandTimeouts) {
      caps.commandTimeouts = (0, _utils.normalizeCommandTimeouts)(caps.commandTimeouts);
    }

    if (_lodash.default.isString(caps.webDriverAgentUrl)) {
      const {
        protocol,
        host
      } = _url.default.parse(caps.webDriverAgentUrl);

      if (_lodash.default.isEmpty(protocol) || _lodash.default.isEmpty(host)) {
        _logger.default.errorAndThrow(`'webDriverAgentUrl' capability is expected to contain a valid WebDriverAgent server URL. ` + `'${caps.webDriverAgentUrl}' is given instead`);
      }
    }

    if (caps.browserName) {
      if (caps.bundleId) {
        _logger.default.errorAndThrow(`'browserName' cannot be set together with 'bundleId' capability`);
      }

      if (caps.app) {
        _logger.default.warn(`The capabilities should generally not include both an 'app' and a 'browserName'`);
      }
    }

    if (caps.permissions) {
      try {
        for (const [bundleId, perms] of _lodash.default.toPairs(JSON.parse(caps.permissions))) {
          if (!_lodash.default.isString(bundleId)) {
            throw new Error(`'${JSON.stringify(bundleId)}' must be a string`);
          }

          if (!_lodash.default.isPlainObject(perms)) {
            throw new Error(`'${JSON.stringify(perms)}' must be a JSON object`);
          }
        }
      } catch (e) {
        _logger.default.errorAndThrow(`'${caps.permissions}' is expected to be a valid object with format ` + `{"<bundleId1>": {"<serviceName1>": "<serviceStatus1>", ...}, ...}. Original error: ${e.message}`);
      }
    }

    return true;
  }

  async installAUT() {
    if (this.isSafari()) {
      return;
    }

    if (this.opts.autoLaunch === false) {
      return;
    }

    try {
      await (0, _utils.verifyApplicationPlatform)(this.opts.app, this.isSimulator());
    } catch (err) {
      _logger.default.warn(`*********************************`);

      _logger.default.warn(`${this.isSimulator() ? 'Simulator' : 'Real device'} architecture appears to be unsupported ` + `by the '${this.opts.app}' application. ` + `Make sure the correct deployment target has been selected for its compilation in Xcode.`);

      _logger.default.warn('Don\'t be surprised if the application fails to launch.');

      _logger.default.warn(`*********************************`);
    }

    if (this.isRealDevice()) {
      await (0, _realDeviceManagement.installToRealDevice)(this.opts.device, this.opts.app, this.opts.bundleId, this.opts.noReset);
    } else {
      await (0, _simulatorManagement.installToSimulator)(this.opts.device, this.opts.app, this.opts.bundleId, this.opts.noReset);
    }

    if (_appiumSupport.util.hasValue(this.opts.iosInstallPause)) {
      let pause = parseInt(this.opts.iosInstallPause, 10);

      _logger.default.debug(`iosInstallPause set. Pausing ${pause} ms before continuing`);

      await _bluebird.default.delay(pause);
    }
  }

  async setInitialOrientation(orientation) {
    if (!_lodash.default.isString(orientation)) {
      _logger.default.info('Skipping setting of the initial display orientation. ' + 'Set the "orientation" capability to either "LANDSCAPE" or "PORTRAIT", if this is an undesired behavior.');

      return;
    }

    orientation = orientation.toUpperCase();

    if (!_lodash.default.includes(['LANDSCAPE', 'PORTRAIT'], orientation)) {
      _logger.default.debug(`Unable to set initial orientation to '${orientation}'`);

      return;
    }

    _logger.default.debug(`Setting initial orientation to '${orientation}'`);

    try {
      await this.proxyCommand('/orientation', 'POST', {
        orientation
      });
      this.opts.curOrientation = orientation;
    } catch (err) {
      _logger.default.warn(`Setting initial orientation failed with: ${err.message}`);
    }
  }

  _getCommandTimeout(cmdName) {
    if (this.opts.commandTimeouts) {
      if (cmdName && _lodash.default.has(this.opts.commandTimeouts, cmdName)) {
        return this.opts.commandTimeouts[cmdName];
      }

      return this.opts.commandTimeouts[_utils.DEFAULT_TIMEOUT_KEY];
    }
  }

  async getSession() {
    const driverSession = await super.getSession();

    if (!this.wdaCaps) {
      this.wdaCaps = await this.proxyCommand('/', 'GET');
    }

    if (!this.deviceCaps) {
      const {
        statusBarSize,
        scale
      } = await this.getScreenInfo();
      this.deviceCaps = {
        pixelRatio: scale,
        statBarHeight: statusBarSize.height,
        viewportRect: await this.getViewportRect()
      };
    }

    _logger.default.info('Merging WDA caps over Appium caps for session detail response');

    return Object.assign({
      udid: this.opts.udid
    }, driverSession, this.wdaCaps.capabilities, this.deviceCaps);
  }

  async startIWDP() {
    this.logEvent('iwdpStarting');
    this.iwdpServer = new _appiumIosDriver.IWDP({
      webkitDebugProxyPort: this.opts.webkitDebugProxyPort,
      udid: this.opts.udid,
      logStdout: !!this.opts.showIWDPLog
    });
    await this.iwdpServer.start();
    this.logEvent('iwdpStarted');
  }

  async stopIWDP() {
    if (this.iwdpServer) {
      await this.iwdpServer.stop();
      delete this.iwdpServer;
    }
  }

  async reset() {
    if (this.opts.noReset) {
      let opts = _lodash.default.cloneDeep(this.opts);

      opts.noReset = false;
      opts.fullReset = false;
      const shutdownHandler = this.resetOnUnexpectedShutdown;

      this.resetOnUnexpectedShutdown = () => {};

      try {
        await this.runReset(opts);
      } finally {
        this.resetOnUnexpectedShutdown = shutdownHandler;
      }
    }

    await super.reset();
  }

}

exports.XCUITestDriver = XCUITestDriver;
Object.assign(XCUITestDriver.prototype, _index.default);
var _default = XCUITestDriver;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9kcml2ZXIuanMiXSwibmFtZXMiOlsiU0FGQVJJX0JVTkRMRV9JRCIsIldEQV9TSU1fU1RBUlRVUF9SRVRSSUVTIiwiV0RBX1JFQUxfREVWX1NUQVJUVVBfUkVUUklFUyIsIldEQV9SRUFMX0RFVl9UVVRPUklBTF9VUkwiLCJXREFfU1RBUlRVUF9SRVRSWV9JTlRFUlZBTCIsIkRFRkFVTFRfU0VUVElOR1MiLCJuYXRpdmVXZWJUYXAiLCJ1c2VKU09OU291cmNlIiwic2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcyIsImVsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXMiLCJtanBlZ1NlcnZlclNjcmVlbnNob3RRdWFsaXR5IiwibWpwZWdTZXJ2ZXJGcmFtZXJhdGUiLCJzY3JlZW5zaG90UXVhbGl0eSIsIlNIQVJFRF9SRVNPVVJDRVNfR1VBUkQiLCJBc3luY0xvY2siLCJOT19QUk9YWV9OQVRJVkVfTElTVCIsIk5PX1BST1hZX1dFQl9MSVNUIiwiY29uY2F0IiwiTUVNT0laRURfRlVOQ1RJT05TIiwiWENVSVRlc3REcml2ZXIiLCJCYXNlRHJpdmVyIiwiY29uc3RydWN0b3IiLCJvcHRzIiwic2hvdWxkVmFsaWRhdGVDYXBzIiwiZGVzaXJlZENhcENvbnN0cmFpbnRzIiwibG9jYXRvclN0cmF0ZWdpZXMiLCJ3ZWJMb2NhdG9yU3RyYXRlZ2llcyIsInJlc2V0SW9zIiwic2V0dGluZ3MiLCJEZXZpY2VTZXR0aW5ncyIsIm9uU2V0dGluZ3NVcGRhdGUiLCJiaW5kIiwibG9ncyIsImZuIiwiXyIsIm1lbW9pemUiLCJrZXkiLCJ2YWx1ZSIsInByb3h5Q29tbWFuZCIsIndkYSIsImRldmljZSIsImp3cFByb3h5QWN0aXZlIiwicHJveHlSZXFSZXMiLCJqd3BQcm94eUF2b2lkIiwic2FmYXJpIiwiY2FjaGVkV2RhU3RhdHVzIiwiY3VyV2ViRnJhbWVzIiwid2ViRWxlbWVudElkcyIsIl9jdXJyZW50VXJsIiwiY3VyQ29udGV4dCIsInhjb2RlVmVyc2lvbiIsImlvc1Nka1ZlcnNpb24iLCJjb250ZXh0cyIsImltcGxpY2l0V2FpdE1zIiwiYXN5bmNsaWJXYWl0TXMiLCJwYWdlTG9hZE1zIiwibGFuZHNjYXBlV2ViQ29vcmRzT2Zmc2V0IiwiZHJpdmVyRGF0YSIsImdldFN0YXR1cyIsImRyaXZlckluZm8iLCJzdGF0dXMiLCJidWlsZCIsInZlcnNpb24iLCJjcmVhdGVTZXNzaW9uIiwiYXJncyIsImxpZmVjeWNsZURhdGEiLCJzZXNzaW9uSWQiLCJjYXBzIiwic3RhcnQiLCJPYmplY3QiLCJhc3NpZ24iLCJkZWZhdWx0U2VydmVyQ2FwcyIsInVkaWQiLCJoYXMiLCJ1cGRhdGVTZXR0aW5ncyIsIndkYVNldHRpbmdzIiwibG9nIiwiaW5mbyIsIm1qcGVnU2NyZWVuc2hvdFVybCIsIm1qcGVnU3RyZWFtIiwibWpwZWciLCJNSnBlZ1N0cmVhbSIsImUiLCJlcnJvciIsImRlbGV0ZVNlc3Npb24iLCJub1Jlc2V0IiwiZnVsbFJlc2V0IiwicGxhdGZvcm1WZXJzaW9uIiwidXRpbCIsImNvbXBhcmVWZXJzaW9ucyIsIkVycm9yIiwicmVhbERldmljZSIsImRldGVybWluZURldmljZSIsImlzRW1wdHkiLCJ3ZWJEcml2ZXJBZ2VudFVybCIsImxvZ0V2ZW50IiwiZW5hYmxlQXN5bmNFeGVjdXRlRnJvbUh0dHBzIiwiaXNSZWFsRGV2aWNlIiwic3RhcnRIdHRwc0FzeW5jU2VydmVyIiwiaXNGdW5jdGlvbiIsImdldFBsYXRmb3JtVmVyc2lvbiIsImJyb3dzZXJOYW1lIiwidG9Mb3dlckNhc2UiLCJhcHAiLCJ1bmRlZmluZWQiLCJwcm9jZXNzQXJndW1lbnRzIiwiYnVuZGxlSWQiLCJzYWZhcmlJbml0aWFsVXJsIiwiYWRkcmVzcyIsInBvcnQiLCJjb25maWd1cmVBcHAiLCJhcHBVdGlscyIsImV4dHJhY3RCdW5kbGVJZCIsInJ1blJlc2V0IiwibWVtb2l6ZWRMb2dJbmZvIiwibG9nSW5mbyIsInN0YXJ0TG9nQ2FwdHVyZSIsInNraXBMb2dDYXB0dXJlIiwicmVzdWx0IiwiaXNMb2dDYXB0dXJlU3RhcnRlZCIsImlzU2ltdWxhdG9yIiwic2h1dGRvd25PdGhlclNpbXVsYXRvcnMiLCJyZWxheGVkU2VjdXJpdHlFbmFibGVkIiwiZXJyb3JBbmRUaHJvdyIsImhhc1ZhbHVlIiwicmVkdWNlTW90aW9uIiwic2V0UmVkdWNlTW90aW9uIiwibG9jYWxDb25maWciLCJpb3NTZXR0aW5ncyIsInNldExvY2FsZUFuZFByZWZlcmVuY2VzIiwiaXNTYWZhcmkiLCJzaW0iLCJzdGFydFNpbSIsImN1c3RvbVNTTENlcnQiLCJ0cnVuY2F0ZSIsImxlbmd0aCIsImluc3RhbGxBVVQiLCJpc0FwcEluc3RhbGxlZCIsInBlcm1pc3Npb25zIiwiZGVidWciLCJwZXJtaXNzaW9uc01hcHBpbmciLCJ0b1BhaXJzIiwiSlNPTiIsInBhcnNlIiwic2V0UGVybWlzc2lvbnMiLCJ3YXJuIiwic3RhcnRXZGEiLCJzZXRJbml0aWFsT3JpZW50YXRpb24iLCJvcmllbnRhdGlvbiIsInN0YXJ0SVdEUCIsIml3ZHBTZXJ2ZXIiLCJlbmRwb2ludCIsImVyciIsIm1lc3NhZ2UiLCJhdXRvV2VidmlldyIsIm5hdlRvSW5pdGlhbFdlYnZpZXciLCJzZXRVcmwiLCJjYWxlbmRhckFjY2Vzc0F1dGhvcml6ZWQiLCJlbmFibGVDYWxlbmRhckFjY2VzcyIsImRpc2FibGVDYWxlbmRhckFjY2VzcyIsIldlYkRyaXZlckFnZW50IiwiY2xlYW51cE9ic29sZXRlUHJvY2Vzc2VzIiwic3luY2hyb25pemF0aW9uS2V5IiwidXNlWGN0ZXN0cnVuRmlsZSIsImlzU291cmNlRnJlc2giLCJuYW1lIiwicGF0aCIsIm5vcm1hbGl6ZSIsInJldHJpZXZlRGVyaXZlZERhdGFQYXRoIiwiaXNCdXN5IiwiZGVyaXZlZERhdGFQYXRoIiwiYm9vdHN0cmFwUGF0aCIsImFjcXVpcmUiLCJ1c2VOZXdXREEiLCJxdWl0QW5kVW5pbnN0YWxsIiwic2V0dXBDYWNoaW5nIiwidXBkYXRlZFdEQUJ1bmRsZUlkIiwibXNnIiwic3RhcnR1cFJldHJpZXMiLCJ3ZGFTdGFydHVwUmV0cmllcyIsInN0YXJ0dXBSZXRyeUludGVydmFsIiwid2RhU3RhcnR1cFJldHJ5SW50ZXJ2YWwiLCJyZXRyeUNvdW50IiwicmV0cmllcyIsIm1ham9yIiwibGF1bmNoIiwiZXJyb3JNc2ciLCJvcmlnaW5hbFN0YWNrdHJhY2UiLCJzdGFydFdkYVNlc3Npb24iLCJzdGFjayIsInByZXZlbnRXREFBdHRhY2htZW50cyIsImNsZWFyU3lzdGVtRmlsZXMiLCJmdWxseVN0YXJ0ZWQiLCJzZXJ2ZXIiLCJzdG9wIiwiaXNBcHBUZW1wb3JhcnkiLCJmcyIsInJpbXJhZiIsImlzV2ViQ29udGV4dCIsInN0b3BSZW1vdGUiLCJyZXNldE9uU2Vzc2lvblN0YXJ0T25seSIsImNyZWF0ZVNpbSIsImRlbGV0ZSIsInN5c2xvZyIsInN0b3BDYXB0dXJlIiwic3RvcElXRFAiLCJzdG9wSHR0cHNBc3luY1NlcnZlciIsImp3cHJveHkiLCJxdWl0IiwiZXhlY3V0ZUNvbW1hbmQiLCJjbWQiLCJyZWNlaXZlQXN5bmNSZXNwb25zZSIsImFwcElzUGFja2FnZU9yQnVuZGxlIiwidGVzdCIsIm9yaWdpbmFsQXBwUGF0aCIsImhlbHBlcnMiLCJleGlzdHMiLCJpc1NhbWVEZXN0aW5hdGlvbiIsImRldmljZU5hbWUiLCJkZXZpY2VzIiwiam9pbiIsImluY2x1ZGVzIiwiZW5mb3JjZUZyZXNoU2ltdWxhdG9yQ3JlYXRpb24iLCJydW5PcHRzIiwic2NhbGVGYWN0b3IiLCJjb25uZWN0SGFyZHdhcmVLZXlib2FyZCIsImlzSGVhZGxlc3MiLCJkZXZpY2VQcmVmZXJlbmNlcyIsIlNpbXVsYXRvcldpbmRvd0NlbnRlciIsImlzU3RyaW5nIiwidG9VcHBlckNhc2UiLCJTaW11bGF0b3JXaW5kb3dPcmllbnRhdGlvbiIsIlNpbXVsYXRvcldpbmRvd1JvdGF0aW9uQW5nbGUiLCJydW4iLCJwbGF0Zm9ybU5hbWUiLCJQTEFURk9STV9OQU1FX1RWT1MiLCJQTEFURk9STV9OQU1FX0lPUyIsImxhdW5jaEFwcCIsIkFQUF9MQVVOQ0hfVElNRU9VVCIsImNoZWNrU3RhdHVzIiwicmVzcG9uc2UiLCJjdXJyZW50QXBwIiwiYnVuZGxlSUQiLCJwYXJzZUludCIsImlzQXJyYXkiLCJzdHJpbmdpZnkiLCJlbnYiLCJpc1BsYWluT2JqZWN0Iiwic2hvdWxkV2FpdEZvclF1aWVzY2VuY2UiLCJ3YWl0Rm9yUXVpZXNjZW5jZSIsIm1heFR5cGluZ0ZyZXF1ZW5jeSIsInNob3VsZFVzZVNpbmdsZXRvblRlc3RNYW5hZ2VyIiwic2hvdWxkVXNlVGVzdE1hbmFnZXJGb3JWaXNpYmlsaXR5RGV0ZWN0aW9uIiwiZXZlbnRsb29wSWRsZURlbGF5U2VjIiwid2RhRXZlbnRsb29wSWRsZURlbGF5Iiwic2ltcGxlSXNWaXNpYmxlQ2hlY2siLCJsYW5ndWFnZSIsInB1c2giLCJsb2NhbGUiLCJkZXNpcmVkIiwiZGVzaXJlZENhcGFiaWxpdGllcyIsImFyZ3VtZW50cyIsImVudmlyb25tZW50IiwiZWxlbWVudFJlc3BvbnNlRmllbGRzIiwiYXV0b0FjY2VwdEFsZXJ0cyIsImRlZmF1bHRBbGVydEFjdGlvbiIsImF1dG9EaXNtaXNzQWxlcnRzIiwicHJveHlBY3RpdmUiLCJnZXRQcm94eUF2b2lkTGlzdCIsImlzV2VidmlldyIsImNhblByb3h5IiwidmFsaWRhdGVMb2NhdG9yU3RyYXRlZ3kiLCJzdHJhdGVneSIsInZhbGlkYXRlRGVzaXJlZENhcHMiLCJjb2VyY2VWZXJzaW9uIiwidmVyaWZ5UHJvY2Vzc0FyZ3VtZW50IiwiaXNOaWwiLCJrZXljaGFpblBhdGgiLCJrZXljaGFpblBhc3N3b3JkIiwiY29tbWFuZFRpbWVvdXRzIiwicHJvdG9jb2wiLCJob3N0IiwidXJsIiwicGVybXMiLCJhdXRvTGF1bmNoIiwiaW9zSW5zdGFsbFBhdXNlIiwicGF1c2UiLCJCIiwiZGVsYXkiLCJjdXJPcmllbnRhdGlvbiIsIl9nZXRDb21tYW5kVGltZW91dCIsImNtZE5hbWUiLCJERUZBVUxUX1RJTUVPVVRfS0VZIiwiZ2V0U2Vzc2lvbiIsImRyaXZlclNlc3Npb24iLCJ3ZGFDYXBzIiwiZGV2aWNlQ2FwcyIsInN0YXR1c0JhclNpemUiLCJzY2FsZSIsImdldFNjcmVlbkluZm8iLCJwaXhlbFJhdGlvIiwic3RhdEJhckhlaWdodCIsImhlaWdodCIsInZpZXdwb3J0UmVjdCIsImdldFZpZXdwb3J0UmVjdCIsImNhcGFiaWxpdGllcyIsIklXRFAiLCJ3ZWJraXREZWJ1Z1Byb3h5UG9ydCIsImxvZ1N0ZG91dCIsInNob3dJV0RQTG9nIiwicmVzZXQiLCJjbG9uZURlZXAiLCJzaHV0ZG93bkhhbmRsZXIiLCJyZXNldE9uVW5leHBlY3RlZFNodXRkb3duIiwicHJvdG90eXBlIiwiY29tbWFuZHMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBQUE7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBR0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBTUE7O0FBR0E7O0FBQ0E7O0FBQ0E7O0FBR0EsTUFBTUEsZ0JBQWdCLEdBQUcsd0JBQXpCO0FBQ0EsTUFBTUMsdUJBQXVCLEdBQUcsQ0FBaEM7QUFDQSxNQUFNQyw0QkFBNEIsR0FBRyxDQUFyQztBQUNBLE1BQU1DLHlCQUF5QixHQUFHLHlGQUFsQztBQUNBLE1BQU1DLDBCQUEwQixHQUFHLEtBQW5DO0FBQ0EsTUFBTUMsZ0JBQWdCLEdBQUc7QUFDdkJDLEVBQUFBLFlBQVksRUFBRSxLQURTO0FBRXZCQyxFQUFBQSxhQUFhLEVBQUUsS0FGUTtBQUd2QkMsRUFBQUEseUJBQXlCLEVBQUUsSUFISjtBQUl2QkMsRUFBQUEseUJBQXlCLEVBQUUsWUFKSjtBQU12QkMsRUFBQUEsNEJBQTRCLEVBQUUsRUFOUDtBQU92QkMsRUFBQUEsb0JBQW9CLEVBQUUsRUFQQztBQVF2QkMsRUFBQUEsaUJBQWlCLEVBQUU7QUFSSSxDQUF6QjtBQVlBLE1BQU1DLHNCQUFzQixHQUFHLElBQUlDLGtCQUFKLEVBQS9CO0FBR0EsTUFBTUMsb0JBQW9CLEdBQUcsQ0FDM0IsQ0FBQyxRQUFELEVBQVcsUUFBWCxDQUQyQixF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QUFkLEVBQXVCO0FBRXJCLFVBQUkvRCxJQUFJLEdBQUdZLGdCQUFFcVIsU0FBRixDQUFZLEtBQUtqUyxJQUFqQixDQUFYOztBQUNBQSxNQUFBQSxJQUFJLENBQUMrRCxPQUFMLEdBQWUsS0FBZjtBQUNBL0QsTUFBQUEsSUFBSSxDQUFDZ0UsU0FBTCxHQUFpQixLQUFqQjtBQUNBLFlBQU1rTyxlQUFlLEdBQUcsS0FBS0MseUJBQTdCOztBQUNBLFdBQUtBLHlCQUFMLEdBQWlDLE1BQU0sQ0FBRSxDQUF6Qzs7QUFDQSxVQUFJO0FBQ0YsY0FBTSxLQUFLeE0sUUFBTCxDQUFjM0YsSUFBZCxDQUFOO0FBQ0QsT0FGRCxTQUVVO0FBQ1IsYUFBS21TLHlCQUFMLEdBQWlDRCxlQUFqQztBQUNEO0FBQ0Y7O0FBQ0QsVUFBTSxNQUFNRixLQUFOLEVBQU47QUFDRDs7QUEzaUNxQzs7O0FBOGlDeENqUCxNQUFNLENBQUNDLE1BQVAsQ0FBY25ELGNBQWMsQ0FBQ3VTLFNBQTdCLEVBQXdDQyxjQUF4QztlQUVleFMsYyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEJhc2VEcml2ZXIsIERldmljZVNldHRpbmdzIH0gZnJvbSAnYXBwaXVtLWJhc2UtZHJpdmVyJztcbmltcG9ydCB7IHV0aWwsIGZzLCBtanBlZyB9IGZyb20gJ2FwcGl1bS1zdXBwb3J0JztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgdXJsIGZyb20gJ3VybCc7XG5pbXBvcnQgeyBsYXVuY2gsIG9wZW5VcmwgfSBmcm9tICdub2RlLXNpbWN0bCc7XG5pbXBvcnQgV2ViRHJpdmVyQWdlbnQgZnJvbSAnLi93ZGEvd2ViZHJpdmVyYWdlbnQnO1xuaW1wb3J0IGxvZyBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQge1xuICBjcmVhdGVTaW0sIGdldEV4aXN0aW5nU2ltLCBydW5TaW11bGF0b3JSZXNldCwgaW5zdGFsbFRvU2ltdWxhdG9yLFxuICBzaHV0ZG93bk90aGVyU2ltdWxhdG9ycywgc2h1dGRvd25TaW11bGF0b3IgfSBmcm9tICcuL3NpbXVsYXRvci1tYW5hZ2VtZW50JztcbmltcG9ydCB7IHNpbUV4aXN0cywgZ2V0U2ltdWxhdG9yLCBpbnN0YWxsU1NMQ2VydCwgaGFzU1NMQ2VydCB9IGZyb20gJ2FwcGl1bS1pb3Mtc2ltdWxhdG9yJztcbmltcG9ydCB7IHJldHJ5SW50ZXJ2YWwsIHJldHJ5IH0gZnJvbSAnYXN5bmNib3gnO1xuaW1wb3J0IHsgc2V0dGluZ3MgYXMgaW9zU2V0dGluZ3MsIGRlZmF1bHRTZXJ2ZXJDYXBzLCBhcHBVdGlscywgSVdEUCB9IGZyb20gJ2FwcGl1bS1pb3MtZHJpdmVyJztcbmltcG9ydCB7IGRlc2lyZWRDYXBDb25zdHJhaW50cywgUExBVEZPUk1fTkFNRV9JT1MsIFBMQVRGT1JNX05BTUVfVFZPUyB9IGZyb20gJy4vZGVzaXJlZC1jYXBzJztcbmltcG9ydCBjb21tYW5kcyBmcm9tICcuL2NvbW1hbmRzL2luZGV4JztcbmltcG9ydCB7XG4gIGRldGVjdFVkaWQsIGdldEFuZENoZWNrWGNvZGVWZXJzaW9uLCBnZXRBbmRDaGVja0lvc1Nka1ZlcnNpb24sXG4gIGFkanVzdFdEQUF0dGFjaG1lbnRzUGVybWlzc2lvbnMsIGNoZWNrQXBwUHJlc2VudCwgZ2V0RHJpdmVySW5mbyxcbiAgY2xlYXJTeXN0ZW1GaWxlcywgdHJhbnNsYXRlRGV2aWNlTmFtZSwgbm9ybWFsaXplQ29tbWFuZFRpbWVvdXRzLFxuICBERUZBVUxUX1RJTUVPVVRfS0VZLCBtYXJrU3lzdGVtRmlsZXNGb3JDbGVhbnVwLFxuICBwcmludFVzZXIsIHJlbW92ZUFsbFNlc3Npb25XZWJTb2NrZXRIYW5kbGVycywgdmVyaWZ5QXBwbGljYXRpb25QbGF0Zm9ybSwgaXNUdk9TIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQge1xuICBnZXRDb25uZWN0ZWREZXZpY2VzLCBydW5SZWFsRGV2aWNlUmVzZXQsIGluc3RhbGxUb1JlYWxEZXZpY2UsXG4gIGdldFJlYWxEZXZpY2VPYmogfSBmcm9tICcuL3JlYWwtZGV2aWNlLW1hbmFnZW1lbnQnO1xuaW1wb3J0IEIgZnJvbSAnYmx1ZWJpcmQnO1xuaW1wb3J0IEFzeW5jTG9jayBmcm9tICdhc3luYy1sb2NrJztcbmltcG9ydCBwYXRoIGZyb20gJ3BhdGgnO1xuXG5cbmNvbnN0IFNBRkFSSV9CVU5ETEVfSUQgPSAnY29tLmFwcGxlLm1vYmlsZXNhZmFyaSc7XG5jb25zdCBXREFfU0lNX1NUQVJUVVBfUkVUUklFUyA9IDI7XG5jb25zdCBXREFfUkVBTF9ERVZfU1RBUlRVUF9SRVRSSUVTID0gMTtcbmNvbnN0IFdEQV9SRUFMX0RFVl9UVVRPUklBTF9VUkwgPSAnaHR0cHM6Ly9naXRodWIuY29tL2FwcGl1bS9hcHBpdW0teGN1aXRlc3QtZHJpdmVyL2Jsb2IvbWFzdGVyL2RvY3MvcmVhbC1kZXZpY2UtY29uZmlnLm1kJztcbmNvbnN0IFdEQV9TVEFSVFVQX1JFVFJZX0lOVEVSVkFMID0gMTAwMDA7XG5jb25zdCBERUZBVUxUX1NFVFRJTkdTID0ge1xuICBuYXRpdmVXZWJUYXA6IGZhbHNlLFxuICB1c2VKU09OU291cmNlOiBmYWxzZSxcbiAgc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlczogdHJ1ZSxcbiAgZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlczogJ3R5cGUsbGFiZWwnLFxuICAvLyBSZWFkIGh0dHBzOi8vZ2l0aHViLmNvbS9hcHBpdW0vV2ViRHJpdmVyQWdlbnQvYmxvYi9tYXN0ZXIvV2ViRHJpdmVyQWdlbnRMaWIvVXRpbGl0aWVzL0ZCQ29uZmlndXJhdGlvbi5tIGZvciBmb2xsb3dpbmcgc2V0dGluZ3MnIHZhbHVlc1xuICBtanBlZ1NlcnZlclNjcmVlbnNob3RRdWFsaXR5OiAyNSxcbiAgbWpwZWdTZXJ2ZXJGcmFtZXJhdGU6IDEwLFxuICBzY3JlZW5zaG90UXVhbGl0eTogMSxcbn07XG4vLyBUaGlzIGxvY2sgYXNzdXJlcywgdGhhdCBlYWNoIGRyaXZlciBzZXNzaW9uIGRvZXMgbm90XG4vLyBhZmZlY3Qgc2hhcmVkIHJlc291cmNlcyBvZiB0aGUgb3RoZXIgcGFyYWxsZWwgc2Vzc2lvbnNcbmNvbnN0IFNIQVJFRF9SRVNPVVJDRVNfR1VBUkQgPSBuZXcgQXN5bmNMb2NrKCk7XG5cbi8qIGVzbGludC1kaXNhYmxlIG5vLXVzZWxlc3MtZXNjYXBlICovXG5jb25zdCBOT19QUk9YWV9OQVRJVkVfTElTVCA9IFtcbiAgWydERUxFVEUnLCAvd2luZG93L10sXG4gIFsnR0VUJywgL15cXC9zZXNzaW9uXFwvW15cXC9dKyQvXSxcbiAgWydHRVQnLCAvYWxlcnRfdGV4dC9dLFxuICBbJ0dFVCcsIC9hbGVydFxcL1teXFwvXSsvXSxcbiAgWydHRVQnLCAvYXBwaXVtL10sXG4gIFsnR0VUJywgL2F0dHJpYnV0ZS9dLFxuICBbJ0dFVCcsIC9jb250ZXh0L10sXG4gIFsnR0VUJywgL2xvY2F0aW9uL10sXG4gIFsnR0VUJywgL2xvZy9dLFxuICBbJ0dFVCcsIC9zY3JlZW5zaG90L10sXG4gIFsnR0VUJywgL3NpemUvXSxcbiAgWydHRVQnLCAvc291cmNlL10sXG4gIFsnR0VUJywgL3VybC9dLFxuICBbJ0dFVCcsIC93aW5kb3cvXSxcbiAgWydQT1NUJywgL2FjY2VwdF9hbGVydC9dLFxuICBbJ1BPU1QnLCAvYWN0aW9ucyQvXSxcbiAgWydQT1NUJywgL2FsZXJ0X3RleHQvXSxcbiAgWydQT1NUJywgL2FsZXJ0XFwvW15cXC9dKy9dLFxuICBbJ1BPU1QnLCAvYXBwaXVtL10sXG4gIFsnUE9TVCcsIC9hcHBpdW1cXC9kZXZpY2VcXC9pc19sb2NrZWQvXSxcbiAgWydQT1NUJywgL2FwcGl1bVxcL2RldmljZVxcL2xvY2svXSxcbiAgWydQT1NUJywgL2FwcGl1bVxcL2RldmljZVxcL3VubG9jay9dLFxuICBbJ1BPU1QnLCAvYmFjay9dLFxuICBbJ1BPU1QnLCAvY2xlYXIvXSxcbiAgWydQT1NUJywgL2NvbnRleHQvXSxcbiAgWydQT1NUJywgL2Rpc21pc3NfYWxlcnQvXSxcbiAgWydQT1NUJywgL2VsZW1lbnQkL10sXG4gIFsnUE9TVCcsIC9lbGVtZW50cyQvXSxcbiAgWydQT1NUJywgL2V4ZWN1dGUvXSxcbiAgWydQT1NUJywgL2tleXMvXSxcbiAgWydQT1NUJywgL2xvZy9dLFxuICBbJ1BPU1QnLCAvbW92ZXRvL10sXG4gIFsnUE9TVCcsIC9yZWNlaXZlX2FzeW5jX3Jlc3BvbnNlL10sIC8vIGFsd2F5cywgaW4gY2FzZSBjb250ZXh0IHN3aXRjaGVzIHdoaWxlIHdhaXRpbmdcbiAgWydQT1NUJywgL3Nlc3Npb25cXC9bXlxcL10rXFwvbG9jYXRpb24vXSwgLy8gZ2VvIGxvY2F0aW9uLCBidXQgbm90IGVsZW1lbnQgbG9jYXRpb25cbiAgWydQT1NUJywgL3NoYWtlL10sXG4gIFsnUE9TVCcsIC90aW1lb3V0cy9dLFxuICBbJ1BPU1QnLCAvdG91Y2gvXSxcbiAgWydQT1NUJywgL3VybC9dLFxuICBbJ1BPU1QnLCAvdmFsdWUvXSxcbiAgWydQT1NUJywgL3dpbmRvdy9dLFxuXTtcbmNvbnN0IE5PX1BST1hZX1dFQl9MSVNUID0gW1xuICBbJ0RFTEVURScsIC9jb29raWUvXSxcbiAgWydHRVQnLCAvYXR0cmlidXRlL10sXG4gIFsnR0VUJywgL2Nvb2tpZS9dLFxuICBbJ0dFVCcsIC9lbGVtZW50L10sXG4gIFsnR0VUJywgL3RleHQvXSxcbiAgWydHRVQnLCAvdGl0bGUvXSxcbiAgWydQT1NUJywgL2NsZWFyL10sXG4gIFsnUE9TVCcsIC9jbGljay9dLFxuICBbJ1BPU1QnLCAvY29va2llL10sXG4gIFsnUE9TVCcsIC9lbGVtZW50L10sXG4gIFsnUE9TVCcsIC9mb3J3YXJkL10sXG4gIFsnUE9TVCcsIC9mcmFtZS9dLFxuICBbJ1BPU1QnLCAva2V5cy9dLFxuICBbJ1BPU1QnLCAvcmVmcmVzaC9dLFxuXS5jb25jYXQoTk9fUFJPWFlfTkFUSVZFX0xJU1QpO1xuLyogZXNsaW50LWVuYWJsZSBuby11c2VsZXNzLWVzY2FwZSAqL1xuXG5jb25zdCBNRU1PSVpFRF9GVU5DVElPTlMgPSBbXG4gICdnZXRTdGF0dXNCYXJIZWlnaHQnLFxuICAnZ2V0RGV2aWNlUGl4ZWxSYXRpbycsXG4gICdnZXRTY3JlZW5JbmZvJyxcbiAgJ2dldFNhZmFyaUlzSXBob25lJyxcbiAgJ2dldFNhZmFyaUlzSXBob25lWCcsXG5dO1xuXG5jbGFzcyBYQ1VJVGVzdERyaXZlciBleHRlbmRzIEJhc2VEcml2ZXIge1xuICBjb25zdHJ1Y3RvciAob3B0cyA9IHt9LCBzaG91bGRWYWxpZGF0ZUNhcHMgPSB0cnVlKSB7XG4gICAgc3VwZXIob3B0cywgc2hvdWxkVmFsaWRhdGVDYXBzKTtcblxuICAgIHRoaXMuZGVzaXJlZENhcENvbnN0cmFpbnRzID0gZGVzaXJlZENhcENvbnN0cmFpbnRzO1xuXG4gICAgdGhpcy5sb2NhdG9yU3RyYXRlZ2llcyA9IFtcbiAgICAgICd4cGF0aCcsXG4gICAgICAnaWQnLFxuICAgICAgJ25hbWUnLFxuICAgICAgJ2NsYXNzIG5hbWUnLFxuICAgICAgJy1pb3MgcHJlZGljYXRlIHN0cmluZycsXG4gICAgICAnLWlvcyBjbGFzcyBjaGFpbicsXG4gICAgICAnYWNjZXNzaWJpbGl0eSBpZCdcbiAgICBdO1xuICAgIHRoaXMud2ViTG9jYXRvclN0cmF0ZWdpZXMgPSBbXG4gICAgICAnbGluayB0ZXh0JyxcbiAgICAgICdjc3Mgc2VsZWN0b3InLFxuICAgICAgJ3RhZyBuYW1lJyxcbiAgICAgICdsaW5rIHRleHQnLFxuICAgICAgJ3BhcnRpYWwgbGluayB0ZXh0J1xuICAgIF07XG4gICAgdGhpcy5yZXNldElvcygpO1xuICAgIHRoaXMuc2V0dGluZ3MgPSBuZXcgRGV2aWNlU2V0dGluZ3MoREVGQVVMVF9TRVRUSU5HUywgdGhpcy5vblNldHRpbmdzVXBkYXRlLmJpbmQodGhpcykpO1xuICAgIHRoaXMubG9ncyA9IHt9O1xuXG4gICAgLy8gbWVtb2l6ZSBmdW5jdGlvbnMgaGVyZSwgc28gdGhhdCB0aGV5IGFyZSBkb25lIG9uIGEgcGVyLWluc3RhbmNlIGJhc2lzXG4gICAgZm9yIChjb25zdCBmbiBvZiBNRU1PSVpFRF9GVU5DVElPTlMpIHtcbiAgICAgIHRoaXNbZm5dID0gXy5tZW1vaXplKHRoaXNbZm5dKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBvblNldHRpbmdzVXBkYXRlIChrZXksIHZhbHVlKSB7XG4gICAgaWYgKGtleSAhPT0gJ25hdGl2ZVdlYlRhcCcpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL2FwcGl1bS9zZXR0aW5ncycsICdQT1NUJywge1xuICAgICAgICBzZXR0aW5nczoge1trZXldOiB2YWx1ZX1cbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aGlzLm9wdHMubmF0aXZlV2ViVGFwID0gISF2YWx1ZTtcbiAgfVxuXG4gIHJlc2V0SW9zICgpIHtcbiAgICB0aGlzLm9wdHMgPSB0aGlzLm9wdHMgfHwge307XG4gICAgdGhpcy53ZGEgPSBudWxsO1xuICAgIHRoaXMub3B0cy5kZXZpY2UgPSBudWxsO1xuICAgIHRoaXMuandwUHJveHlBY3RpdmUgPSBmYWxzZTtcbiAgICB0aGlzLnByb3h5UmVxUmVzID0gbnVsbDtcbiAgICB0aGlzLmp3cFByb3h5QXZvaWQgPSBbXTtcbiAgICB0aGlzLnNhZmFyaSA9IGZhbHNlO1xuICAgIHRoaXMuY2FjaGVkV2RhU3RhdHVzID0gbnVsbDtcblxuICAgIC8vIHNvbWUgdGhpbmdzIHRoYXQgY29tbWFuZHMgaW1wb3J0ZWQgZnJvbSBhcHBpdW0taW9zLWRyaXZlciBuZWVkXG4gICAgdGhpcy5jdXJXZWJGcmFtZXMgPSBbXTtcbiAgICB0aGlzLndlYkVsZW1lbnRJZHMgPSBbXTtcbiAgICB0aGlzLl9jdXJyZW50VXJsID0gbnVsbDtcbiAgICB0aGlzLmN1ckNvbnRleHQgPSBudWxsO1xuICAgIHRoaXMueGNvZGVWZXJzaW9uID0ge307XG4gICAgdGhpcy5pb3NTZGtWZXJzaW9uID0gbnVsbDtcbiAgICB0aGlzLmNvbnRleHRzID0gW107XG4gICAgdGhpcy5pbXBsaWNpdFdhaXRNcyA9IDA7XG4gICAgdGhpcy5hc3luY2xpYldhaXRNcyA9IDA7XG4gICAgdGhpcy5wYWdlTG9hZE1zID0gNjAwMDtcbiAgICB0aGlzLmxhbmRzY2FwZVdlYkNvb3Jkc09mZnNldCA9IDA7XG4gIH1cblxuICBnZXQgZHJpdmVyRGF0YSAoKSB7XG4gICAgLy8gVE9ETyBmaWxsIG91dCByZXNvdXJjZSBpbmZvIGhlcmVcbiAgICByZXR1cm4ge307XG4gIH1cblxuICBhc3luYyBnZXRTdGF0dXMgKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5kcml2ZXJJbmZvID09PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhpcy5kcml2ZXJJbmZvID0gYXdhaXQgZ2V0RHJpdmVySW5mbygpO1xuICAgIH1cbiAgICBsZXQgc3RhdHVzID0ge2J1aWxkOiB7dmVyc2lvbjogdGhpcy5kcml2ZXJJbmZvLnZlcnNpb259fTtcbiAgICBpZiAodGhpcy5jYWNoZWRXZGFTdGF0dXMpIHtcbiAgICAgIHN0YXR1cy53ZGEgPSB0aGlzLmNhY2hlZFdkYVN0YXR1cztcbiAgICB9XG4gICAgcmV0dXJuIHN0YXR1cztcbiAgfVxuXG4gIGFzeW5jIGNyZWF0ZVNlc3Npb24gKC4uLmFyZ3MpIHtcbiAgICB0aGlzLmxpZmVjeWNsZURhdGEgPSB7fTsgLy8gdGhpcyBpcyB1c2VkIGZvciBrZWVwaW5nIHRyYWNrIG9mIHRoZSBzdGF0ZSB3ZSBzdGFydCBzbyB3aGVuIHdlIGRlbGV0ZSB0aGUgc2Vzc2lvbiB3ZSBjYW4gcHV0IHRoaW5ncyBiYWNrXG4gICAgdHJ5IHtcbiAgICAgIC8vIFRPRE8gYWRkIHZhbGlkYXRpb24gb24gY2Fwc1xuICAgICAgbGV0IFtzZXNzaW9uSWQsIGNhcHNdID0gYXdhaXQgc3VwZXIuY3JlYXRlU2Vzc2lvbiguLi5hcmdzKTtcbiAgICAgIHRoaXMub3B0cy5zZXNzaW9uSWQgPSBzZXNzaW9uSWQ7XG5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnQoKTtcblxuICAgICAgLy8gbWVyZ2Ugc2VydmVyIGNhcGFiaWxpdGllcyArIGRlc2lyZWQgY2FwYWJpbGl0aWVzXG4gICAgICBjYXBzID0gT2JqZWN0LmFzc2lnbih7fSwgZGVmYXVsdFNlcnZlckNhcHMsIGNhcHMpO1xuICAgICAgLy8gdXBkYXRlIHRoZSB1ZGlkIHdpdGggd2hhdCBpcyBhY3R1YWxseSB1c2VkXG4gICAgICBjYXBzLnVkaWQgPSB0aGlzLm9wdHMudWRpZDtcbiAgICAgIC8vIGVuc3VyZSB3ZSB0cmFjayBuYXRpdmVXZWJUYXAgY2FwYWJpbGl0eSBhcyBhIHNldHRpbmcgYXMgd2VsbFxuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ25hdGl2ZVdlYlRhcCcpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMudXBkYXRlU2V0dGluZ3Moe25hdGl2ZVdlYlRhcDogdGhpcy5vcHRzLm5hdGl2ZVdlYlRhcH0pO1xuICAgICAgfVxuICAgICAgLy8gZW5zdXJlIHdlIHRyYWNrIHVzZUpTT05Tb3VyY2UgY2FwYWJpbGl0eSBhcyBhIHNldHRpbmcgYXMgd2VsbFxuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ3VzZUpTT05Tb3VyY2UnKSkge1xuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZVNldHRpbmdzKHt1c2VKU09OU291cmNlOiB0aGlzLm9wdHMudXNlSlNPTlNvdXJjZX0pO1xuICAgICAgfVxuXG4gICAgICBsZXQgd2RhU2V0dGluZ3MgPSB7XG4gICAgICAgIGVsZW1lbnRSZXNwb25zZUF0dHJpYnV0ZXM6IERFRkFVTFRfU0VUVElOR1MuZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlcyxcbiAgICAgICAgc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlczogREVGQVVMVF9TRVRUSU5HUy5zaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzLFxuICAgICAgfTtcbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsICdlbGVtZW50UmVzcG9uc2VBdHRyaWJ1dGVzJykpIHtcbiAgICAgICAgd2RhU2V0dGluZ3MuZWxlbWVudFJlc3BvbnNlQXR0cmlidXRlcyA9IHRoaXMub3B0cy5lbGVtZW50UmVzcG9uc2VBdHRyaWJ1dGVzO1xuICAgICAgfVxuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ3Nob3VsZFVzZUNvbXBhY3RSZXNwb25zZXMnKSkge1xuICAgICAgICB3ZGFTZXR0aW5ncy5zaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzID0gdGhpcy5vcHRzLnNob3VsZFVzZUNvbXBhY3RSZXNwb25zZXM7XG4gICAgICB9XG4gICAgICBpZiAoXy5oYXModGhpcy5vcHRzLCAnbWpwZWdTZXJ2ZXJTY3JlZW5zaG90UXVhbGl0eScpKSB7XG4gICAgICAgIHdkYVNldHRpbmdzLm1qcGVnU2VydmVyU2NyZWVuc2hvdFF1YWxpdHkgPSB0aGlzLm9wdHMubWpwZWdTZXJ2ZXJTY3JlZW5zaG90UXVhbGl0eTtcbiAgICAgIH1cbiAgICAgIGlmIChfLmhhcyh0aGlzLm9wdHMsICdtanBlZ1NlcnZlckZyYW1lcmF0ZScpKSB7XG4gICAgICAgIHdkYVNldHRpbmdzLm1qcGVnU2VydmVyRnJhbWVyYXRlID0gdGhpcy5vcHRzLm1qcGVnU2VydmVyRnJhbWVyYXRlO1xuICAgICAgfVxuICAgICAgaWYgKF8uaGFzKHRoaXMub3B0cywgJ3NjcmVlbnNob3RRdWFsaXR5JykpIHtcbiAgICAgICAgbG9nLmluZm8oYFNldHRpbmcgdGhlIHF1YWxpdHkgb2YgcGhvbmUgc2NyZWVuc2hvdDogJyR7dGhpcy5vcHRzLnNjcmVlbnNob3RRdWFsaXR5fSdgKTtcbiAgICAgICAgd2RhU2V0dGluZ3Muc2NyZWVuc2hvdFF1YWxpdHkgPSB0aGlzLm9wdHMuc2NyZWVuc2hvdFF1YWxpdHk7XG4gICAgICB9XG4gICAgICAvLyBlbnN1cmUgV0RBIGdldHMgb3VyIGRlZmF1bHRzIGluc3RlYWQgb2Ygd2hhdGV2ZXIgaXRzIG93biBtaWdodCBiZVxuICAgICAgYXdhaXQgdGhpcy51cGRhdGVTZXR0aW5ncyh3ZGFTZXR0aW5ncyk7XG5cbiAgICAgIC8vIHR1cm4gb24gbWpwZWcgc3RyZWFtIHJlYWRpbmcgaWYgcmVxdWVzdGVkXG4gICAgICBpZiAodGhpcy5vcHRzLm1qcGVnU2NyZWVuc2hvdFVybCkge1xuICAgICAgICBsb2cuaW5mbyhgU3RhcnRpbmcgTUpQRUcgc3RyZWFtIHJlYWRpbmcgVVJMOiAnJHt0aGlzLm9wdHMubWpwZWdTY3JlZW5zaG90VXJsfSdgKTtcbiAgICAgICAgdGhpcy5tanBlZ1N0cmVhbSA9IG5ldyBtanBlZy5NSnBlZ1N0cmVhbSh0aGlzLm9wdHMubWpwZWdTY3JlZW5zaG90VXJsKTtcbiAgICAgICAgYXdhaXQgdGhpcy5tanBlZ1N0cmVhbS5zdGFydCgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIFtzZXNzaW9uSWQsIGNhcHNdO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGxvZy5lcnJvcihlKTtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlU2Vzc2lvbigpO1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzdGFydCAoKSB7XG4gICAgdGhpcy5vcHRzLm5vUmVzZXQgPSAhIXRoaXMub3B0cy5ub1Jlc2V0O1xuICAgIHRoaXMub3B0cy5mdWxsUmVzZXQgPSAhIXRoaXMub3B0cy5mdWxsUmVzZXQ7XG5cbiAgICBhd2FpdCBwcmludFVzZXIoKTtcblxuICAgIC8vIFRPRE86IHBsYXRmb3JtVmVyc2lvbiBzaG91bGQgYmUgYSByZXF1aXJlZCBjYXBhYmlsaXR5XG4gICAgaWYgKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gJiYgdXRpbC5jb21wYXJlVmVyc2lvbnModGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiwgJzwnLCAnOS4zJykpIHtcbiAgICAgIHRocm93IEVycm9yKGBQbGF0Zm9ybSB2ZXJzaW9uIG11c3QgYmUgOS4zIG9yIGFib3ZlLiAnJHt0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9ufScgaXMgbm90IHN1cHBvcnRlZC5gKTtcbiAgICB9XG5cbiAgICBjb25zdCB7ZGV2aWNlLCB1ZGlkLCByZWFsRGV2aWNlfSA9IGF3YWl0IHRoaXMuZGV0ZXJtaW5lRGV2aWNlKCk7XG4gICAgbG9nLmluZm8oYERldGVybWluaW5nIGRldmljZSB0byBydW4gdGVzdHMgb246IHVkaWQ6ICcke3VkaWR9JywgcmVhbCBkZXZpY2U6ICR7cmVhbERldmljZX1gKTtcbiAgICB0aGlzLm9wdHMuZGV2aWNlID0gZGV2aWNlO1xuICAgIHRoaXMub3B0cy51ZGlkID0gdWRpZDtcbiAgICB0aGlzLm9wdHMucmVhbERldmljZSA9IHJlYWxEZXZpY2U7XG4gICAgdGhpcy5vcHRzLmlvc1Nka1ZlcnNpb24gPSBudWxsOyAvLyBGb3IgV0RBIGFuZCB4Y29kZWJ1aWxkXG5cbiAgICBpZiAoXy5pc0VtcHR5KHRoaXMueGNvZGVWZXJzaW9uKSAmJiAoIXRoaXMub3B0cy53ZWJEcml2ZXJBZ2VudFVybCB8fCAhdGhpcy5vcHRzLnJlYWxEZXZpY2UpKSB7XG4gICAgICAvLyBubyBgd2ViRHJpdmVyQWdlbnRVcmxgLCBvciBvbiBhIHNpbXVsYXRvciwgc28gd2UgbmVlZCBhbiBYY29kZSB2ZXJzaW9uXG4gICAgICB0aGlzLnhjb2RlVmVyc2lvbiA9IGF3YWl0IGdldEFuZENoZWNrWGNvZGVWZXJzaW9uKCk7XG4gICAgICB0aGlzLmlvc1Nka1ZlcnNpb24gPSBhd2FpdCBnZXRBbmRDaGVja0lvc1Nka1ZlcnNpb24oKTtcbiAgICAgIHRoaXMub3B0cy5pb3NTZGtWZXJzaW9uID0gdGhpcy5pb3NTZGtWZXJzaW9uOyAvLyBQYXNzIHRvIHhjb2RlYnVpbGRcbiAgICAgIGxvZy5pbmZvKGBpT1MgU0RLIFZlcnNpb24gc2V0IHRvICcke3RoaXMub3B0cy5pb3NTZGtWZXJzaW9ufSdgKTtcbiAgICB9XG4gICAgdGhpcy5sb2dFdmVudCgneGNvZGVEZXRhaWxzUmV0cmlldmVkJyk7XG5cbiAgICBpZiAodGhpcy5vcHRzLmVuYWJsZUFzeW5jRXhlY3V0ZUZyb21IdHRwcyAmJiAhdGhpcy5pc1JlYWxEZXZpY2UoKSkge1xuICAgICAgLy8gc2h1dGRvd24gdGhlIHNpbXVsYXRvciBzbyB0aGF0IHRoZSBzc2wgY2VydCBpcyByZWNvZ25pemVkXG4gICAgICBhd2FpdCBzaHV0ZG93blNpbXVsYXRvcih0aGlzLm9wdHMuZGV2aWNlKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRIdHRwc0FzeW5jU2VydmVyKCk7XG4gICAgfVxuXG4gICAgLy8gYXQgdGhpcyBwb2ludCBpZiB0aGVyZSBpcyBubyBwbGF0Zm9ybVZlcnNpb24sIGdldCBpdCBmcm9tIHRoZSBkZXZpY2VcbiAgICBpZiAoIXRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24pIHtcbiAgICAgIGlmICh0aGlzLm9wdHMuZGV2aWNlICYmIF8uaXNGdW5jdGlvbih0aGlzLm9wdHMuZGV2aWNlLmdldFBsYXRmb3JtVmVyc2lvbikpIHtcbiAgICAgICAgdGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiA9IGF3YWl0IHRoaXMub3B0cy5kZXZpY2UuZ2V0UGxhdGZvcm1WZXJzaW9uKCk7XG4gICAgICAgIGxvZy5pbmZvKGBObyBwbGF0Zm9ybVZlcnNpb24gc3BlY2lmaWVkLiBVc2luZyBkZXZpY2UgdmVyc2lvbjogJyR7dGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbn0nYCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBUT0RPOiB0aGlzIGlzIHdoZW4gaXQgaXMgYSByZWFsIGRldmljZS4gd2hlbiB3ZSBoYXZlIGEgcmVhbCBvYmplY3Qgd2lyZSBpdCBpblxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICgodGhpcy5vcHRzLmJyb3dzZXJOYW1lIHx8ICcnKS50b0xvd2VyQ2FzZSgpID09PSAnc2FmYXJpJykge1xuICAgICAgbG9nLmluZm8oJ1NhZmFyaSB0ZXN0IHJlcXVlc3RlZCcpO1xuICAgICAgdGhpcy5zYWZhcmkgPSB0cnVlO1xuICAgICAgdGhpcy5vcHRzLmFwcCA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMub3B0cy5wcm9jZXNzQXJndW1lbnRzID0gdGhpcy5vcHRzLnByb2Nlc3NBcmd1bWVudHMgfHwge307XG4gICAgICB0aGlzLm9wdHMuYnVuZGxlSWQgPSBTQUZBUklfQlVORExFX0lEO1xuICAgICAgdGhpcy5fY3VycmVudFVybCA9IHRoaXMub3B0cy5zYWZhcmlJbml0aWFsVXJsIHx8IChcbiAgICAgICAgdGhpcy5pc1JlYWxEZXZpY2UoKVxuICAgICAgICAgID8gJ2h0dHA6Ly9hcHBpdW0uaW8nXG4gICAgICAgICAgOiBgaHR0cDovLyR7dGhpcy5vcHRzLmFkZHJlc3N9OiR7dGhpcy5vcHRzLnBvcnR9L3dlbGNvbWVgXG4gICAgICApO1xuICAgICAgdGhpcy5vcHRzLnByb2Nlc3NBcmd1bWVudHMuYXJncyA9IFsnLXUnLCB0aGlzLl9jdXJyZW50VXJsXTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5jb25maWd1cmVBcHAoKTtcbiAgICB9XG4gICAgdGhpcy5sb2dFdmVudCgnYXBwQ29uZmlndXJlZCcpO1xuXG4gICAgLy8gZmFpbCB2ZXJ5IGVhcmx5IGlmIHRoZSBhcHAgZG9lc24ndCBhY3R1YWxseSBleGlzdFxuICAgIC8vIG9yIGlmIGJ1bmRsZSBpZCBkb2Vzbid0IHBvaW50IHRvIGFuIGluc3RhbGxlZCBhcHBcbiAgICBpZiAodGhpcy5vcHRzLmFwcCkge1xuICAgICAgYXdhaXQgY2hlY2tBcHBQcmVzZW50KHRoaXMub3B0cy5hcHApO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5vcHRzLmJ1bmRsZUlkKSB7XG4gICAgICB0aGlzLm9wdHMuYnVuZGxlSWQgPSBhd2FpdCBhcHBVdGlscy5leHRyYWN0QnVuZGxlSWQodGhpcy5vcHRzLmFwcCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5ydW5SZXNldCgpO1xuXG4gICAgY29uc3QgbWVtb2l6ZWRMb2dJbmZvID0gXy5tZW1vaXplKGZ1bmN0aW9uIGxvZ0luZm8gKCkge1xuICAgICAgbG9nLmluZm8oXCInc2tpcExvZ0NhcHR1cmUnIGlzIHNldC4gU2tpcHBpbmcgc3RhcnRpbmcgbG9ncyBzdWNoIGFzIGNyYXNoLCBzeXN0ZW0sIHNhZmFyaSBjb25zb2xlIGFuZCBzYWZhcmkgbmV0d29yay5cIik7XG4gICAgfSk7XG4gICAgY29uc3Qgc3RhcnRMb2dDYXB0dXJlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMub3B0cy5za2lwTG9nQ2FwdHVyZSkge1xuICAgICAgICBtZW1vaXplZExvZ0luZm8oKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0YXJ0TG9nQ2FwdHVyZSgpO1xuICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICB0aGlzLmxvZ0V2ZW50KCdsb2dDYXB0dXJlU3RhcnRlZCcpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICAgIGNvbnN0IGlzTG9nQ2FwdHVyZVN0YXJ0ZWQgPSBhd2FpdCBzdGFydExvZ0NhcHR1cmUoKTtcblxuICAgIGxvZy5pbmZvKGBTZXR0aW5nIHVwICR7dGhpcy5pc1JlYWxEZXZpY2UoKSA/ICdyZWFsIGRldmljZScgOiAnc2ltdWxhdG9yJ31gKTtcblxuICAgIGlmICh0aGlzLmlzU2ltdWxhdG9yKCkpIHtcbiAgICAgIGlmICh0aGlzLm9wdHMuc2h1dGRvd25PdGhlclNpbXVsYXRvcnMpIHtcbiAgICAgICAgaWYgKCF0aGlzLnJlbGF4ZWRTZWN1cml0eUVuYWJsZWQpIHtcbiAgICAgICAgICBsb2cuZXJyb3JBbmRUaHJvdyhgQXBwaXVtIHNlcnZlciBtdXN0IGhhdmUgcmVsYXhlZCBzZWN1cml0eSBmbGFnIHNldCBpbiBvcmRlciBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBgZm9yICdzaHV0ZG93bk90aGVyU2ltdWxhdG9ycycgY2FwYWJpbGl0eSB0byB3b3JrYCk7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgc2h1dGRvd25PdGhlclNpbXVsYXRvcnModGhpcy5vcHRzLmRldmljZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIHNldCByZWR1Y2VNb3Rpb24gaWYgY2FwYWJpbGl0eSBpcyBzZXRcbiAgICAgIGlmICh1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5yZWR1Y2VNb3Rpb24pKSB7XG4gICAgICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2Uuc2V0UmVkdWNlTW90aW9uKHRoaXMub3B0cy5yZWR1Y2VNb3Rpb24pO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmxvY2FsQ29uZmlnID0gYXdhaXQgaW9zU2V0dGluZ3Muc2V0TG9jYWxlQW5kUHJlZmVyZW5jZXModGhpcy5vcHRzLmRldmljZSwgdGhpcy5vcHRzLCB0aGlzLmlzU2FmYXJpKCksIGFzeW5jIChzaW0pID0+IHtcbiAgICAgICAgYXdhaXQgc2h1dGRvd25TaW11bGF0b3Ioc2ltKTtcblxuICAgICAgICAvLyB3ZSBkb24ndCBrbm93IGlmIHRoZXJlIG5lZWRzIHRvIGJlIGNoYW5nZXMgYSBwcmlvcmksIHNvIGNoYW5nZSBmaXJzdC5cbiAgICAgICAgLy8gc29tZXRpbWVzIHRoZSBzaHV0ZG93biBwcm9jZXNzIGNoYW5nZXMgdGhlIHNldHRpbmdzLCBzbyByZXNldCB0aGVtLFxuICAgICAgICAvLyBrbm93aW5nIHRoYXQgdGhlIHNpbSBpcyBhbHJlYWR5IHNodXRcbiAgICAgICAgYXdhaXQgaW9zU2V0dGluZ3Muc2V0TG9jYWxlQW5kUHJlZmVyZW5jZXMoc2ltLCB0aGlzLm9wdHMsIHRoaXMuaXNTYWZhcmkoKSk7XG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgdGhpcy5zdGFydFNpbSgpO1xuXG4gICAgICBpZiAodGhpcy5vcHRzLmN1c3RvbVNTTENlcnQpIHtcbiAgICAgICAgaWYgKGF3YWl0IGhhc1NTTENlcnQodGhpcy5vcHRzLmN1c3RvbVNTTENlcnQsIHRoaXMub3B0cy51ZGlkKSkge1xuICAgICAgICAgIGxvZy5pbmZvKGBTU0wgY2VydCAnJHtfLnRydW5jYXRlKHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0LCB7bGVuZ3RoOiAyMH0pfScgYWxyZWFkeSBpbnN0YWxsZWRgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsb2cuaW5mbyhgSW5zdGFsbGluZyBzc2wgY2VydCAnJHtfLnRydW5jYXRlKHRoaXMub3B0cy5jdXN0b21TU0xDZXJ0LCB7bGVuZ3RoOiAyMH0pfSdgKTtcbiAgICAgICAgICBhd2FpdCBzaHV0ZG93blNpbXVsYXRvcih0aGlzLm9wdHMuZGV2aWNlKTtcbiAgICAgICAgICBhd2FpdCBpbnN0YWxsU1NMQ2VydCh0aGlzLm9wdHMuY3VzdG9tU1NMQ2VydCwgdGhpcy5vcHRzLnVkaWQpO1xuICAgICAgICAgIGxvZy5pbmZvKGBSZXN0YXJ0aW5nIFNpbXVsYXRvciBzbyB0aGF0IFNTTCBjZXJ0aWZpY2F0ZSBpbnN0YWxsYXRpb24gdGFrZXMgZWZmZWN0YCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zdGFydFNpbSgpO1xuICAgICAgICAgIHRoaXMubG9nRXZlbnQoJ2N1c3RvbUNlcnRJbnN0YWxsZWQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB0aGlzLmxvZ0V2ZW50KCdzaW1TdGFydGVkJyk7XG4gICAgICBpZiAoIWlzTG9nQ2FwdHVyZVN0YXJ0ZWQpIHtcbiAgICAgICAgLy8gUmV0cnkgbG9nIGNhcHR1cmUgaWYgU2ltdWxhdG9yIHdhcyBub3QgcnVubmluZyBiZWZvcmVcbiAgICAgICAgYXdhaXQgc3RhcnRMb2dDYXB0dXJlKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0cy5hcHApIHtcbiAgICAgIGF3YWl0IHRoaXMuaW5zdGFsbEFVVCgpO1xuICAgICAgdGhpcy5sb2dFdmVudCgnYXBwSW5zdGFsbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gaWYgd2Ugb25seSBoYXZlIGJ1bmRsZSBpZGVudGlmaWVyIGFuZCBubyBhcHAsIGZhaWwgaWYgaXQgaXMgbm90IGFscmVhZHkgaW5zdGFsbGVkXG4gICAgaWYgKCF0aGlzLm9wdHMuYXBwICYmIHRoaXMub3B0cy5idW5kbGVJZCAmJiAhdGhpcy5zYWZhcmkpIHtcbiAgICAgIGlmICghYXdhaXQgdGhpcy5vcHRzLmRldmljZS5pc0FwcEluc3RhbGxlZCh0aGlzLm9wdHMuYnVuZGxlSWQpKSB7XG4gICAgICAgIGxvZy5lcnJvckFuZFRocm93KGBBcHAgd2l0aCBidW5kbGUgaWRlbnRpZmllciAnJHt0aGlzLm9wdHMuYnVuZGxlSWR9JyB1bmtub3duYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMub3B0cy5wZXJtaXNzaW9ucykge1xuICAgICAgaWYgKHRoaXMuaXNTaW11bGF0b3IoKSkge1xuICAgICAgICBsb2cuZGVidWcoJ1NldHRpbmcgdGhlIHJlcXVlc3RlZCBwZXJtaXNzaW9ucyBiZWZvcmUgV0RBIGlzIHN0YXJ0ZWQnKTtcbiAgICAgICAgZm9yIChjb25zdCBbYnVuZGxlSWQsIHBlcm1pc3Npb25zTWFwcGluZ10gb2YgXy50b1BhaXJzKEpTT04ucGFyc2UodGhpcy5vcHRzLnBlcm1pc3Npb25zKSkpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLnNldFBlcm1pc3Npb25zKGJ1bmRsZUlkLCBwZXJtaXNzaW9uc01hcHBpbmcpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2cud2FybignU2V0dGluZyBwZXJtaXNzaW9ucyBpcyBvbmx5IHN1cHBvcnRlZCBvbiBTaW11bGF0b3IuICcgK1xuICAgICAgICAgICdUaGUgXCJwZXJtaXNzaW9uc1wiIGNhcGFiaWxpdHkgd2lsbCBiZSBpZ25vcmVkLicpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc3RhcnRXZGEodGhpcy5vcHRzLnNlc3Npb25JZCwgcmVhbERldmljZSk7XG5cbiAgICBhd2FpdCB0aGlzLnNldEluaXRpYWxPcmllbnRhdGlvbih0aGlzLm9wdHMub3JpZW50YXRpb24pO1xuICAgIHRoaXMubG9nRXZlbnQoJ29yaWVudGF0aW9uU2V0Jyk7XG5cbiAgICAvLyBUT0RPOiBwbGF0Zm9ybVZlcnNpb24gc2hvdWxkIGJlIGEgcmVxdWlyZWQgY2FwXG4gICAgLy8gcmVhbCBkZXZpY2VzIHdpbGwgYmUgaGFuZGxlZCBsYXRlciwgYWZ0ZXIgdGhlIHdlYiBjb250ZXh0IGhhcyBiZWVuIGluaXRpYWxpemVkXG4gICAgaWYgKHRoaXMuaXNTYWZhcmkoKSAmJiAhdGhpcy5pc1JlYWxEZXZpY2UoKSAmJiB1dGlsLmNvbXBhcmVWZXJzaW9ucyh0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uLCAnPj0nLCAnMTIuMicpKSB7XG4gICAgICAvLyBvbiAxMi4yIHRoZSBwYWdlIGlzIG5vdCBvcGVuZWQgaW4gV0RBXG4gICAgICBhd2FpdCBvcGVuVXJsKHRoaXMub3B0cy5kZXZpY2UudWRpZCwgdGhpcy5fY3VycmVudFVybCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkgJiYgdGhpcy5vcHRzLnN0YXJ0SVdEUCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgdGhpcy5zdGFydElXRFAoKTtcbiAgICAgICAgbG9nLmRlYnVnKGBTdGFydGVkIGlvc193ZWJraXRfZGVidWcgcHJveHkgc2VydmVyIGF0OiAke3RoaXMuaXdkcFNlcnZlci5lbmRwb2ludH1gKTtcbiAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICBsb2cuZXJyb3JBbmRUaHJvdyhgQ291bGQgbm90IHN0YXJ0IGlvc193ZWJraXRfZGVidWdfcHJveHkgc2VydmVyOiAke2Vyci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmlzU2FmYXJpKCkgfHwgdGhpcy5vcHRzLmF1dG9XZWJ2aWV3KSB7XG4gICAgICBsb2cuZGVidWcoJ1dhaXRpbmcgZm9yIGluaXRpYWwgd2VidmlldycpO1xuICAgICAgYXdhaXQgdGhpcy5uYXZUb0luaXRpYWxXZWJ2aWV3KCk7XG4gICAgICB0aGlzLmxvZ0V2ZW50KCdpbml0aWFsV2Vidmlld05hdmlnYXRlZCcpO1xuICAgIH1cblxuICAgIC8vIFRPRE86IHBsYXRmb3JtVmVyc2lvbiBzaG91bGQgYmUgYSByZXF1aXJlZCBjYXBcbiAgICBpZiAodGhpcy5pc1NhZmFyaSgpICYmIHRoaXMuaXNSZWFsRGV2aWNlKCkgJiYgdXRpbC5jb21wYXJlVmVyc2lvbnModGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiwgJz49JywgJzEyLjInKSkge1xuICAgICAgLy8gb24gMTIuMiB0aGUgcGFnZSBpcyBub3Qgb3BlbmVkIGluIFdEQVxuICAgICAgYXdhaXQgdGhpcy5zZXRVcmwodGhpcy5fY3VycmVudFVybCk7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmlzUmVhbERldmljZSgpKSB7XG4gICAgICBpZiAodGhpcy5vcHRzLmNhbGVuZGFyQWNjZXNzQXV0aG9yaXplZCkge1xuICAgICAgICBhd2FpdCB0aGlzLm9wdHMuZGV2aWNlLmVuYWJsZUNhbGVuZGFyQWNjZXNzKHRoaXMub3B0cy5idW5kbGVJZCk7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMub3B0cy5jYWxlbmRhckFjY2Vzc0F1dGhvcml6ZWQgPT09IGZhbHNlKSB7XG4gICAgICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2UuZGlzYWJsZUNhbGVuZGFyQWNjZXNzKHRoaXMub3B0cy5idW5kbGVJZCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXJ0IFdlYkRyaXZlckFnZW50UnVubmVyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzZXNzaW9uSWQgLSBUaGUgaWQgb2YgdGhlIHRhcmdldCBzZXNzaW9uIHRvIGxhdW5jaCBXREEgd2l0aC5cbiAgICogQHBhcmFtIHtib29sZWFufSByZWFsRGV2aWNlIC0gRXF1YWxzIHRvIHRydWUgaWYgdGhlIHRlc3QgdGFyZ2V0IGRldmljZSBpcyBhIHJlYWwgZGV2aWNlLlxuICAgKi9cbiAgYXN5bmMgc3RhcnRXZGEgKHNlc3Npb25JZCwgcmVhbERldmljZSkge1xuICAgIHRoaXMud2RhID0gbmV3IFdlYkRyaXZlckFnZW50KHRoaXMueGNvZGVWZXJzaW9uLCB0aGlzLm9wdHMpO1xuXG4gICAgYXdhaXQgdGhpcy53ZGEuY2xlYW51cE9ic29sZXRlUHJvY2Vzc2VzKCk7XG5cbiAgICAvLyBMZXQgbXVsdGlwbGUgV0RBIGJpbmFyaWVzIHdpdGggZGlmZmVyZW50IGRlcml2ZWQgZGF0YSBmb2xkZXJzIGJlIGJ1aWx0IGluIHBhcmFsbGVsXG4gICAgLy8gQ29uY3VycmVudCBXREEgYnVpbGRzIGZyb20gdGhlIHNhbWUgc291cmNlIHdpbGwgY2F1c2UgeGNvZGVidWlsZCBzeW5jaHJvbml6YXRpb24gZXJyb3JzXG4gICAgY29uc3Qgc3luY2hyb25pemF0aW9uS2V5ID0gIXRoaXMub3B0cy51c2VYY3Rlc3RydW5GaWxlICYmIGF3YWl0IHRoaXMud2RhLmlzU291cmNlRnJlc2goKVxuICAgICAgLy8gRmlyc3QtdGltZSBjb21waWxhdGlvbiBpcyBhbiBleHBlbnNpdmUgb3BlcmF0aW9uLCB3aGljaCBpcyBkb25lIGZhc3RlciBpZiBleGVjdXRlZFxuICAgICAgLy8gc2VxdWVudGlhbGx5LiBYY29kZWJ1aWxkIHNwcmVhZHMgdGhlIGxvYWQgY2F1c2VkIGJ5IHRoZSBjbGFuZyBjb21waWxlciB0byBhbGwgYXZhaWxhYmxlIENQVSBjb3Jlc1xuICAgICAgPyBYQ1VJVGVzdERyaXZlci5uYW1lXG4gICAgICA6IHBhdGgubm9ybWFsaXplKGF3YWl0IHRoaXMud2RhLnJldHJpZXZlRGVyaXZlZERhdGFQYXRoKCkpO1xuICAgIGxvZy5kZWJ1ZyhgU3RhcnRpbmcgV2ViRHJpdmVyQWdlbnQgaW5pdGlhbGl6YXRpb24gd2l0aCB0aGUgc3luY2hyb25pemF0aW9uIGtleSAnJHtzeW5jaHJvbml6YXRpb25LZXl9J2ApO1xuICAgIGlmIChTSEFSRURfUkVTT1VSQ0VTX0dVQVJELmlzQnVzeSgpICYmICF0aGlzLm9wdHMuZGVyaXZlZERhdGFQYXRoICYmICF0aGlzLm9wdHMuYm9vdHN0cmFwUGF0aCkge1xuICAgICAgbG9nLmRlYnVnKGBDb25zaWRlciBzZXR0aW5nIGEgdW5pcXVlICdkZXJpdmVkRGF0YVBhdGgnIGNhcGFiaWxpdHkgdmFsdWUgZm9yIGVhY2ggcGFyYWxsZWwgZHJpdmVyIGluc3RhbmNlIGAgK1xuICAgICAgICBgdG8gYXZvaWQgY29uZmxpY3RzIGFuZCBzcGVlZCB1cCB0aGUgYnVpbGRpbmcgcHJvY2Vzc2ApO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgU0hBUkVEX1JFU09VUkNFU19HVUFSRC5hY3F1aXJlKHN5bmNocm9uaXphdGlvbktleSwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMub3B0cy51c2VOZXdXREEpIHtcbiAgICAgICAgbG9nLmRlYnVnKGBDYXBhYmlsaXR5ICd1c2VOZXdXREEnIHNldCB0byB0cnVlLCBzbyB1bmluc3RhbGxpbmcgV0RBIGJlZm9yZSBwcm9jZWVkaW5nYCk7XG4gICAgICAgIGF3YWl0IHRoaXMud2RhLnF1aXRBbmRVbmluc3RhbGwoKTtcbiAgICAgICAgdGhpcy5sb2dFdmVudCgnd2RhVW5pbnN0YWxsZWQnKTtcbiAgICAgIH0gZWxzZSBpZiAoIXV0aWwuaGFzVmFsdWUodGhpcy53ZGEud2ViRHJpdmVyQWdlbnRVcmwpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMud2RhLnNldHVwQ2FjaGluZyh0aGlzLm9wdHMudXBkYXRlZFdEQUJ1bmRsZUlkKTtcbiAgICAgIH1cblxuICAgICAgLy8gbG9jYWwgaGVscGVyIGZvciB0aGUgdHdvIHBsYWNlcyB3ZSBuZWVkIHRvIHVuaW5zdGFsbCB3ZGEgYW5kIHJlLXN0YXJ0IGl0XG4gICAgICBjb25zdCBxdWl0QW5kVW5pbnN0YWxsID0gYXN5bmMgKG1zZykgPT4ge1xuICAgICAgICBsb2cuZGVidWcobXNnKTtcbiAgICAgICAgaWYgKHRoaXMub3B0cy53ZWJEcml2ZXJBZ2VudFVybCkge1xuICAgICAgICAgIGxvZy5kZWJ1ZygnTm90IHF1aXR0aW5nL3VuaW5zdGFsbGluZyBXZWJEcml2ZXJBZ2VudCBzaW5jZSB3ZWJEcml2ZXJBZ2VudFVybCBjYXBhYmlsaXR5IGlzIHByb3ZpZGVkJyk7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgbG9nLndhcm4oJ1F1aXR0aW5nIGFuZCB1bmluc3RhbGxpbmcgV2ViRHJpdmVyQWdlbnQnKTtcbiAgICAgICAgYXdhaXQgdGhpcy53ZGEucXVpdEFuZFVuaW5zdGFsbCgpO1xuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgICAgfTtcblxuICAgICAgY29uc3Qgc3RhcnR1cFJldHJpZXMgPSB0aGlzLm9wdHMud2RhU3RhcnR1cFJldHJpZXMgfHwgKHRoaXMuaXNSZWFsRGV2aWNlKCkgPyBXREFfUkVBTF9ERVZfU1RBUlRVUF9SRVRSSUVTIDogV0RBX1NJTV9TVEFSVFVQX1JFVFJJRVMpO1xuICAgICAgY29uc3Qgc3RhcnR1cFJldHJ5SW50ZXJ2YWwgPSB0aGlzLm9wdHMud2RhU3RhcnR1cFJldHJ5SW50ZXJ2YWwgfHwgV0RBX1NUQVJUVVBfUkVUUllfSU5URVJWQUw7XG4gICAgICBsb2cuZGVidWcoYFRyeWluZyB0byBzdGFydCBXZWJEcml2ZXJBZ2VudCAke3N0YXJ0dXBSZXRyaWVzfSB0aW1lcyB3aXRoICR7c3RhcnR1cFJldHJ5SW50ZXJ2YWx9bXMgaW50ZXJ2YWxgKTtcbiAgICAgIGlmICghdXRpbC5oYXNWYWx1ZSh0aGlzLm9wdHMud2RhU3RhcnR1cFJldHJpZXMpICYmICF1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy53ZGFTdGFydHVwUmV0cnlJbnRlcnZhbCkpIHtcbiAgICAgICAgbG9nLmRlYnVnKGBUaGVzZSB2YWx1ZXMgY2FuIGJlIGN1c3RvbWl6ZWQgYnkgY2hhbmdpbmcgd2RhU3RhcnR1cFJldHJpZXMvd2RhU3RhcnR1cFJldHJ5SW50ZXJ2YWwgY2FwYWJpbGl0aWVzYCk7XG4gICAgICB9XG4gICAgICBsZXQgcmV0cnlDb3VudCA9IDA7XG4gICAgICBhd2FpdCByZXRyeUludGVydmFsKHN0YXJ0dXBSZXRyaWVzLCBzdGFydHVwUmV0cnlJbnRlcnZhbCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICB0aGlzLmxvZ0V2ZW50KCd3ZGFTdGFydEF0dGVtcHRlZCcpO1xuICAgICAgICBpZiAocmV0cnlDb3VudCA+IDApIHtcbiAgICAgICAgICBsb2cuaW5mbyhgUmV0cnlpbmcgV0RBIHN0YXJ0dXAgKCR7cmV0cnlDb3VudCArIDF9IG9mICR7c3RhcnR1cFJldHJpZXN9KWApO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgLy8gb24geGNvZGUgMTAgaW5zdGFsbGQgd2lsbCBvZnRlbiB0cnkgdG8gYWNjZXNzIHRoZSBhcHAgZnJvbSBpdHMgc3RhZ2luZ1xuICAgICAgICAgIC8vIGRpcmVjdG9yeSBiZWZvcmUgZnVsbHkgbW92aW5nIGl0IHRoZXJlLCBhbmQgZmFpbC4gUmV0cnlpbmcgb25jZVxuICAgICAgICAgIC8vIGltbWVkaWF0ZWx5IGhlbHBzXG4gICAgICAgICAgY29uc3QgcmV0cmllcyA9IHRoaXMueGNvZGVWZXJzaW9uLm1ham9yID49IDEwID8gMiA6IDE7XG4gICAgICAgICAgdGhpcy5jYWNoZWRXZGFTdGF0dXMgPSBhd2FpdCByZXRyeShyZXRyaWVzLCB0aGlzLndkYS5sYXVuY2guYmluZCh0aGlzLndkYSksIHNlc3Npb25JZCwgcmVhbERldmljZSk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVN0YXJ0RmFpbGVkJyk7XG4gICAgICAgICAgcmV0cnlDb3VudCsrO1xuICAgICAgICAgIGxldCBlcnJvck1zZyA9IGBVbmFibGUgdG8gbGF1bmNoIFdlYkRyaXZlckFnZW50IGJlY2F1c2Ugb2YgeGNvZGVidWlsZCBmYWlsdXJlOiAke2Vyci5tZXNzYWdlfWA7XG4gICAgICAgICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgICAgICAgIGVycm9yTXNnICs9IGAuIE1ha2Ugc3VyZSB5b3UgZm9sbG93IHRoZSB0dXRvcmlhbCBhdCAke1dEQV9SRUFMX0RFVl9UVVRPUklBTF9VUkx9LiBgICtcbiAgICAgICAgICAgICAgICAgICAgICAgIGBUcnkgdG8gcmVtb3ZlIHRoZSBXZWJEcml2ZXJBZ2VudFJ1bm5lciBhcHBsaWNhdGlvbiBmcm9tIHRoZSBkZXZpY2UgaWYgaXQgaXMgaW5zdGFsbGVkIGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgYGFuZCByZWJvb3QgdGhlIGRldmljZS5gO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBxdWl0QW5kVW5pbnN0YWxsKGVycm9yTXNnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucHJveHlSZXFSZXMgPSB0aGlzLndkYS5wcm94eVJlcVJlcy5iaW5kKHRoaXMud2RhKTtcbiAgICAgICAgdGhpcy5qd3BQcm94eUFjdGl2ZSA9IHRydWU7XG5cbiAgICAgICAgbGV0IG9yaWdpbmFsU3RhY2t0cmFjZSA9IG51bGw7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgcmV0cnlJbnRlcnZhbCgxNSwgMTAwMCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5sb2dFdmVudCgnd2RhU2Vzc2lvbkF0dGVtcHRlZCcpO1xuICAgICAgICAgICAgbG9nLmRlYnVnKCdTZW5kaW5nIGNyZWF0ZVNlc3Npb24gY29tbWFuZCB0byBXREEnKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIHRoaXMuY2FjaGVkV2RhU3RhdHVzID0gdGhpcy5jYWNoZWRXZGFTdGF0dXMgfHwgYXdhaXQgdGhpcy5wcm94eUNvbW1hbmQoJy9zdGF0dXMnLCAnR0VUJyk7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuc3RhcnRXZGFTZXNzaW9uKHRoaXMub3B0cy5idW5kbGVJZCwgdGhpcy5vcHRzLnByb2Nlc3NBcmd1bWVudHMpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICAgIG9yaWdpbmFsU3RhY2t0cmFjZSA9IGVyci5zdGFjaztcbiAgICAgICAgICAgICAgbG9nLmRlYnVnKGBGYWlsZWQgdG8gY3JlYXRlIFdEQSBzZXNzaW9uICgke2Vyci5tZXNzYWdlfSkuIFJldHJ5aW5nLi4uYCk7XG4gICAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICB0aGlzLmxvZ0V2ZW50KCd3ZGFTZXNzaW9uU3RhcnRlZCcpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICBpZiAob3JpZ2luYWxTdGFja3RyYWNlKSB7XG4gICAgICAgICAgICBsb2cuZGVidWcob3JpZ2luYWxTdGFja3RyYWNlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgbGV0IGVycm9yTXNnID0gYFVuYWJsZSB0byBzdGFydCBXZWJEcml2ZXJBZ2VudCBzZXNzaW9uIGJlY2F1c2Ugb2YgeGNvZGVidWlsZCBmYWlsdXJlOiAke2Vyci5tZXNzYWdlfWA7XG4gICAgICAgICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgICAgICAgIGVycm9yTXNnICs9IGAgTWFrZSBzdXJlIHlvdSBmb2xsb3cgdGhlIHR1dG9yaWFsIGF0ICR7V0RBX1JFQUxfREVWX1RVVE9SSUFMX1VSTH0uIGAgK1xuICAgICAgICAgICAgICAgICAgICAgICAgYFRyeSB0byByZW1vdmUgdGhlIFdlYkRyaXZlckFnZW50UnVubmVyIGFwcGxpY2F0aW9uIGZyb20gdGhlIGRldmljZSBpZiBpdCBpcyBpbnN0YWxsZWQgYCArXG4gICAgICAgICAgICAgICAgICAgICAgICBgYW5kIHJlYm9vdCB0aGUgZGV2aWNlLmA7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHF1aXRBbmRVbmluc3RhbGwoZXJyb3JNc2cpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5wcmV2ZW50V0RBQXR0YWNobWVudHMpKSB7XG4gICAgICAgICAgLy8gWENUZXN0IHByaW9yIHRvIFhjb2RlIDkgU0RLIGhhcyBubyBuYXRpdmUgd2F5IHRvIGRpc2FibGUgYXR0YWNobWVudHNcbiAgICAgICAgICB0aGlzLm9wdHMucHJldmVudFdEQUF0dGFjaG1lbnRzID0gdGhpcy54Y29kZVZlcnNpb24ubWFqb3IgPCA5O1xuICAgICAgICAgIGlmICh0aGlzLm9wdHMucHJldmVudFdEQUF0dGFjaG1lbnRzKSB7XG4gICAgICAgICAgICBsb2cuaW5mbygnRW5hYmxlZCBXREEgYXR0YWNobWVudHMgcHJldmVudGlvbiBieSBkZWZhdWx0IHRvIHNhdmUgdGhlIGRpc2sgc3BhY2UuICcgK1xuICAgICAgICAgICAgICAgICAgICAgYFNldCAncHJldmVudFdEQUF0dGFjaG1lbnRzJyBjYXBhYmlsaXR5IHRvIGZhbHNlIGlmIHRoaXMgaXMgYW4gdW5kZXNpcmVkIGJlaGF2aW9yLmApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5vcHRzLnByZXZlbnRXREFBdHRhY2htZW50cykge1xuICAgICAgICAgIGF3YWl0IGFkanVzdFdEQUF0dGFjaG1lbnRzUGVybWlzc2lvbnModGhpcy53ZGEsIHRoaXMub3B0cy5wcmV2ZW50V0RBQXR0YWNobWVudHMgPyAnNTU1JyA6ICc3NTUnKTtcbiAgICAgICAgICB0aGlzLmxvZ0V2ZW50KCd3ZGFQZXJtc0FkanVzdGVkJyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5vcHRzLmNsZWFyU3lzdGVtRmlsZXMpIHtcbiAgICAgICAgICBhd2FpdCBtYXJrU3lzdGVtRmlsZXNGb3JDbGVhbnVwKHRoaXMud2RhKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHdlIGV4cGVjdCBjZXJ0YWluIHNvY2tldCBlcnJvcnMgdW50aWwgdGhpcyBwb2ludCwgYnV0IG5vd1xuICAgICAgICAvLyBtYXJrIHRoaW5ncyBhcyBmdWxseSB3b3JraW5nXG4gICAgICAgIHRoaXMud2RhLmZ1bGx5U3RhcnRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMubG9nRXZlbnQoJ3dkYVN0YXJ0ZWQnKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgcnVuUmVzZXQgKG9wdHMgPSBudWxsKSB7XG4gICAgdGhpcy5sb2dFdmVudCgncmVzZXRTdGFydGVkJyk7XG4gICAgaWYgKHRoaXMuaXNSZWFsRGV2aWNlKCkpIHtcbiAgICAgIGF3YWl0IHJ1blJlYWxEZXZpY2VSZXNldCh0aGlzLm9wdHMuZGV2aWNlLCBvcHRzIHx8IHRoaXMub3B0cyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHJ1blNpbXVsYXRvclJlc2V0KHRoaXMub3B0cy5kZXZpY2UsIG9wdHMgfHwgdGhpcy5vcHRzKTtcbiAgICB9XG4gICAgdGhpcy5sb2dFdmVudCgncmVzZXRDb21wbGV0ZScpO1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlU2Vzc2lvbiAoKSB7XG4gICAgYXdhaXQgcmVtb3ZlQWxsU2Vzc2lvbldlYlNvY2tldEhhbmRsZXJzKHRoaXMuc2VydmVyLCB0aGlzLnNlc3Npb25JZCk7XG5cbiAgICBhd2FpdCB0aGlzLnN0b3AoKTtcblxuICAgIGlmICh0aGlzLm9wdHMuY2xlYXJTeXN0ZW1GaWxlcyAmJiB0aGlzLmlzQXBwVGVtcG9yYXJ5KSB7XG4gICAgICBhd2FpdCBmcy5yaW1yYWYodGhpcy5vcHRzLmFwcCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMud2RhKSB7XG4gICAgICBjb25zdCBzeW5jaHJvbml6YXRpb25LZXkgPSBwYXRoLm5vcm1hbGl6ZShhd2FpdCB0aGlzLndkYS5yZXRyaWV2ZURlcml2ZWREYXRhUGF0aCgpKTtcbiAgICAgIGF3YWl0IFNIQVJFRF9SRVNPVVJDRVNfR1VBUkQuYWNxdWlyZShzeW5jaHJvbml6YXRpb25LZXksIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gcmVzZXQgdGhlIHBlcm1pc3Npb25zIG9uIHRoZSBkZXJpdmVkIGRhdGEgZm9sZGVyLCBpZiBuZWNlc3NhcnlcbiAgICAgICAgaWYgKHRoaXMub3B0cy5wcmV2ZW50V0RBQXR0YWNobWVudHMpIHtcbiAgICAgICAgICBhd2FpdCBhZGp1c3RXREFBdHRhY2htZW50c1Blcm1pc3Npb25zKHRoaXMud2RhLCAnNzU1Jyk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5vcHRzLmNsZWFyU3lzdGVtRmlsZXMpIHtcbiAgICAgICAgICBhd2FpdCBjbGVhclN5c3RlbUZpbGVzKHRoaXMud2RhKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBsb2cuZGVidWcoJ05vdCBjbGVhcmluZyBsb2cgZmlsZXMuIFVzZSBgY2xlYXJTeXN0ZW1GaWxlc2AgY2FwYWJpbGl0eSB0byB0dXJuIG9uLicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1dlYkNvbnRleHQoKSkge1xuICAgICAgbG9nLmRlYnVnKCdJbiBhIHdlYiBzZXNzaW9uLiBSZW1vdmluZyByZW1vdGUgZGVidWdnZXInKTtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcFJlbW90ZSgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdHMucmVzZXRPblNlc3Npb25TdGFydE9ubHkgPT09IGZhbHNlKSB7XG4gICAgICBhd2FpdCB0aGlzLnJ1blJlc2V0KCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNTaW11bGF0b3IoKSAmJiAhdGhpcy5vcHRzLm5vUmVzZXQgJiYgISF0aGlzLm9wdHMuZGV2aWNlKSB7XG4gICAgICBpZiAodGhpcy5saWZlY3ljbGVEYXRhLmNyZWF0ZVNpbSkge1xuICAgICAgICBsb2cuZGVidWcoYERlbGV0aW5nIHNpbXVsYXRvciBjcmVhdGVkIGZvciB0aGlzIHJ1biAodWRpZDogJyR7dGhpcy5vcHRzLnVkaWR9JylgKTtcbiAgICAgICAgYXdhaXQgc2h1dGRvd25TaW11bGF0b3IodGhpcy5vcHRzLmRldmljZSk7XG4gICAgICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2UuZGVsZXRlKCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFfLmlzRW1wdHkodGhpcy5sb2dzKSkge1xuICAgICAgYXdhaXQgdGhpcy5sb2dzLnN5c2xvZy5zdG9wQ2FwdHVyZSgpO1xuICAgICAgdGhpcy5sb2dzID0ge307XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXdkcFNlcnZlcikge1xuICAgICAgYXdhaXQgdGhpcy5zdG9wSVdEUCgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdHMuZW5hYmxlQXN5bmNFeGVjdXRlRnJvbUh0dHBzICYmICF0aGlzLmlzUmVhbERldmljZSgpKSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3BIdHRwc0FzeW5jU2VydmVyKCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubWpwZWdTdHJlYW0pIHtcbiAgICAgIGxvZy5pbmZvKCdDbG9zaW5nIE1KUEVHIHN0cmVhbScpO1xuICAgICAgdGhpcy5tanBlZ1N0cmVhbS5zdG9wKCk7XG4gICAgfVxuXG4gICAgdGhpcy5yZXNldElvcygpO1xuXG4gICAgYXdhaXQgc3VwZXIuZGVsZXRlU2Vzc2lvbigpO1xuICB9XG5cbiAgYXN5bmMgc3RvcCAoKSB7XG4gICAgdGhpcy5qd3BQcm94eUFjdGl2ZSA9IGZhbHNlO1xuICAgIHRoaXMucHJveHlSZXFSZXMgPSBudWxsO1xuXG4gICAgaWYgKHRoaXMud2RhICYmIHRoaXMud2RhLmZ1bGx5U3RhcnRlZCkge1xuICAgICAgaWYgKHRoaXMud2RhLmp3cHJveHkpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZChgL3Nlc3Npb24vJHt0aGlzLnNlc3Npb25JZH1gLCAnREVMRVRFJyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIC8vIGFuIGVycm9yIGhlcmUgc2hvdWxkIG5vdCBzaG9ydC1jaXJjdWl0IHRoZSByZXN0IG9mIGNsZWFuIHVwXG4gICAgICAgICAgbG9nLmRlYnVnKGBVbmFibGUgdG8gREVMRVRFIHNlc3Npb24gb24gV0RBOiAnJHtlcnIubWVzc2FnZX0nLiBDb250aW51aW5nIHNodXRkb3duLmApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAodGhpcy53ZGEgJiYgIXRoaXMud2RhLndlYkRyaXZlckFnZW50VXJsICYmIHRoaXMub3B0cy51c2VOZXdXREEpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53ZGEucXVpdCgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGV4ZWN1dGVDb21tYW5kIChjbWQsIC4uLmFyZ3MpIHtcbiAgICBsb2cuZGVidWcoYEV4ZWN1dGluZyBjb21tYW5kICcke2NtZH0nYCk7XG5cbiAgICBpZiAoY21kID09PSAncmVjZWl2ZUFzeW5jUmVzcG9uc2UnKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWNlaXZlQXN5bmNSZXNwb25zZSguLi5hcmdzKTtcbiAgICB9XG4gICAgLy8gVE9ETzogb25jZSB0aGlzIGZpeCBnZXRzIGludG8gYmFzZSBkcml2ZXIgcmVtb3ZlIGZyb20gaGVyZVxuICAgIGlmIChjbWQgPT09ICdnZXRTdGF0dXMnKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5nZXRTdGF0dXMoKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHN1cGVyLmV4ZWN1dGVDb21tYW5kKGNtZCwgLi4uYXJncyk7XG4gIH1cblxuICBhc3luYyBjb25maWd1cmVBcHAgKCkge1xuICAgIGZ1bmN0aW9uIGFwcElzUGFja2FnZU9yQnVuZGxlIChhcHApIHtcbiAgICAgIHJldHVybiAoL14oW2EtekEtWjAtOVxcLV9dK1xcLlthLXpBLVowLTlcXC1fXSspKyQvKS50ZXN0KGFwcCk7XG4gICAgfVxuXG4gICAgLy8gdGhlIGFwcCBuYW1lIGlzIGEgYnVuZGxlSWQgYXNzaWduIGl0IHRvIHRoZSBidW5kbGVJZCBwcm9wZXJ0eVxuICAgIGlmICghdGhpcy5vcHRzLmJ1bmRsZUlkICYmIGFwcElzUGFja2FnZU9yQnVuZGxlKHRoaXMub3B0cy5hcHApKSB7XG4gICAgICB0aGlzLm9wdHMuYnVuZGxlSWQgPSB0aGlzLm9wdHMuYXBwO1xuICAgICAgdGhpcy5vcHRzLmFwcCA9ICcnO1xuICAgIH1cbiAgICAvLyB3ZSBoYXZlIGEgYnVuZGxlIElELCBidXQgbm8gYXBwLCBvciBhcHAgaXMgYWxzbyBhIGJ1bmRsZVxuICAgIGlmICgodGhpcy5vcHRzLmJ1bmRsZUlkICYmIGFwcElzUGFja2FnZU9yQnVuZGxlKHRoaXMub3B0cy5idW5kbGVJZCkpICYmXG4gICAgICAgICh0aGlzLm9wdHMuYXBwID09PSAnJyB8fCBhcHBJc1BhY2thZ2VPckJ1bmRsZSh0aGlzLm9wdHMuYXBwKSkpIHtcbiAgICAgIGxvZy5kZWJ1ZygnQXBwIGlzIGFuIGlPUyBidW5kbGUsIHdpbGwgYXR0ZW1wdCB0byBydW4gYXMgcHJlLWV4aXN0aW5nJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gY2hlY2sgZm9yIHN1cHBvcnRlZCBidWlsZC1pbiBhcHBzXG4gICAgaWYgKHRoaXMub3B0cy5hcHAgJiYgdGhpcy5vcHRzLmFwcC50b0xvd2VyQ2FzZSgpID09PSAnc2V0dGluZ3MnKSB7XG4gICAgICB0aGlzLm9wdHMuYnVuZGxlSWQgPSAnY29tLmFwcGxlLlByZWZlcmVuY2VzJztcbiAgICAgIHRoaXMub3B0cy5hcHAgPSBudWxsO1xuICAgICAgcmV0dXJuO1xuICAgIH0gZWxzZSBpZiAodGhpcy5vcHRzLmFwcCAmJiB0aGlzLm9wdHMuYXBwLnRvTG93ZXJDYXNlKCkgPT09ICdjYWxlbmRhcicpIHtcbiAgICAgIHRoaXMub3B0cy5idW5kbGVJZCA9ICdjb20uYXBwbGUubW9iaWxlY2FsJztcbiAgICAgIHRoaXMub3B0cy5hcHAgPSBudWxsO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IG9yaWdpbmFsQXBwUGF0aCA9IHRoaXMub3B0cy5hcHA7XG4gICAgdHJ5IHtcbiAgICAgIC8vIGRvd25sb2FkIGlmIG5lY2Vzc2FyeVxuICAgICAgdGhpcy5vcHRzLmFwcCA9IGF3YWl0IHRoaXMuaGVscGVycy5jb25maWd1cmVBcHAodGhpcy5vcHRzLmFwcCwgJy5hcHAnKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvZy5lcnJvcihlcnIpO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBCYWQgYXBwOiAke3RoaXMub3B0cy5hcHB9LiBBcHAgcGF0aHMgbmVlZCB0byBiZSBhYnNvbHV0ZSBvciBhbiBVUkwgdG8gYSBjb21wcmVzc2VkIGZpbGVgKTtcbiAgICB9XG4gICAgdGhpcy5pc0FwcFRlbXBvcmFyeSA9IHRoaXMub3B0cy5hcHAgJiYgYXdhaXQgZnMuZXhpc3RzKHRoaXMub3B0cy5hcHApXG4gICAgICAmJiAhYXdhaXQgdXRpbC5pc1NhbWVEZXN0aW5hdGlvbihvcmlnaW5hbEFwcFBhdGgsIHRoaXMub3B0cy5hcHApO1xuICB9XG5cbiAgYXN5bmMgZGV0ZXJtaW5lRGV2aWNlICgpIHtcbiAgICAvLyBpbiB0aGUgb25lIGNhc2Ugd2hlcmUgd2UgY3JlYXRlIGEgc2ltLCB3ZSB3aWxsIHNldCB0aGlzIHN0YXRlXG4gICAgdGhpcy5saWZlY3ljbGVEYXRhLmNyZWF0ZVNpbSA9IGZhbHNlO1xuXG4gICAgLy8gaWYgd2UgZ2V0IGdlbmVyaWMgbmFtZXMsIHRyYW5zbGF0ZSB0aGVtXG4gICAgdGhpcy5vcHRzLmRldmljZU5hbWUgPSB0cmFuc2xhdGVEZXZpY2VOYW1lKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24sIHRoaXMub3B0cy5kZXZpY2VOYW1lKTtcblxuICAgIGlmICh0aGlzLm9wdHMudWRpZCkge1xuICAgICAgaWYgKHRoaXMub3B0cy51ZGlkLnRvTG93ZXJDYXNlKCkgPT09ICdhdXRvJykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHRoaXMub3B0cy51ZGlkID0gYXdhaXQgZGV0ZWN0VWRpZCgpO1xuICAgICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAvLyBUcnlpbmcgdG8gZmluZCBtYXRjaGluZyBVRElEIGZvciBTaW11bGF0b3JcbiAgICAgICAgICBsb2cud2FybihgQ2Fubm90IGRldGVjdCBhbnkgY29ubmVjdGVkIHJlYWwgZGV2aWNlcy4gRmFsbGluZyBiYWNrIHRvIFNpbXVsYXRvci4gT3JpZ2luYWwgZXJyb3I6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgICAgICAgY29uc3QgZGV2aWNlID0gYXdhaXQgZ2V0RXhpc3RpbmdTaW0odGhpcy5vcHRzKTtcbiAgICAgICAgICBpZiAoIWRldmljZSkge1xuICAgICAgICAgICAgLy8gTm8gbWF0Y2hpbmcgU2ltdWxhdG9yIGlzIGZvdW5kLiBUaHJvdyBhbiBlcnJvclxuICAgICAgICAgICAgbG9nLmVycm9yQW5kVGhyb3coYENhbm5vdCBkZXRlY3QgdWRpZCBmb3IgJHt0aGlzLm9wdHMuZGV2aWNlTmFtZX0gU2ltdWxhdG9yIHJ1bm5pbmcgaU9TICR7dGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbn1gKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gTWF0Y2hpbmcgU2ltdWxhdG9yIGV4aXN0cyBhbmQgaXMgZm91bmQuIFVzZSBpdFxuICAgICAgICAgIHRoaXMub3B0cy51ZGlkID0gZGV2aWNlLnVkaWQ7XG4gICAgICAgICAgcmV0dXJuIHtkZXZpY2UsIHJlYWxEZXZpY2U6IGZhbHNlLCB1ZGlkOiBkZXZpY2UudWRpZH07XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG1ha2Ugc3VyZSBpdCBpcyBhIGNvbm5lY3RlZCBkZXZpY2UuIElmIG5vdCwgdGhlIHVkaWQgcGFzc2VkIGluIGlzIGludmFsaWRcbiAgICAgICAgY29uc3QgZGV2aWNlcyA9IGF3YWl0IGdldENvbm5lY3RlZERldmljZXMoKTtcbiAgICAgICAgbG9nLmRlYnVnKGBBdmFpbGFibGUgZGV2aWNlczogJHtkZXZpY2VzLmpvaW4oJywgJyl9YCk7XG4gICAgICAgIGlmICghZGV2aWNlcy5pbmNsdWRlcyh0aGlzLm9wdHMudWRpZCkpIHtcbiAgICAgICAgICAvLyBjaGVjayBmb3IgYSBwYXJ0aWN1bGFyIHNpbXVsYXRvclxuICAgICAgICAgIGlmIChhd2FpdCBzaW1FeGlzdHModGhpcy5vcHRzLnVkaWQpKSB7XG4gICAgICAgICAgICBjb25zdCBkZXZpY2UgPSBhd2FpdCBnZXRTaW11bGF0b3IodGhpcy5vcHRzLnVkaWQpO1xuICAgICAgICAgICAgcmV0dXJuIHtkZXZpY2UsIHJlYWxEZXZpY2U6IGZhbHNlLCB1ZGlkOiB0aGlzLm9wdHMudWRpZH07XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGRldmljZSBvciBzaW11bGF0b3IgVURJRDogJyR7dGhpcy5vcHRzLnVkaWR9J2ApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGRldmljZSA9IGF3YWl0IGdldFJlYWxEZXZpY2VPYmoodGhpcy5vcHRzLnVkaWQpO1xuICAgICAgcmV0dXJuIHtkZXZpY2UsIHJlYWxEZXZpY2U6IHRydWUsIHVkaWQ6IHRoaXMub3B0cy51ZGlkfTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gJiYgdGhpcy5pb3NTZGtWZXJzaW9uKSB7XG4gICAgICBsb2cuaW5mbyhgTm8gcGxhdGZvcm1WZXJzaW9uIHNwZWNpZmllZC4gVXNpbmcgbGF0ZXN0IHZlcnNpb24gWGNvZGUgc3VwcG9ydHM6ICcke3RoaXMuaW9zU2RrVmVyc2lvbn0nIGAgK1xuICAgICAgICAgICAgICAgYFRoaXMgbWF5IGNhdXNlIHByb2JsZW1zIGlmIGEgc2ltdWxhdG9yIGRvZXMgbm90IGV4aXN0IGZvciB0aGlzIHBsYXRmb3JtIHZlcnNpb24uYCk7XG4gICAgICB0aGlzLm9wdHMucGxhdGZvcm1WZXJzaW9uID0gdGhpcy5pb3NTZGtWZXJzaW9uO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm9wdHMuZW5mb3JjZUZyZXNoU2ltdWxhdG9yQ3JlYXRpb24pIHtcbiAgICAgIGxvZy5kZWJ1ZyhgTmV3IHNpbXVsYXRvciBpcyByZXF1ZXN0ZWQuIElmIHRoaXMgaXMgbm90IHdhbnRlZCwgc2V0ICdlbmZvcmNlRnJlc2hTaW11bGF0b3JDcmVhdGlvbicgY2FwYWJpbGl0eSB0byBmYWxzZWApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBmaWd1cmUgb3V0IHRoZSBjb3JyZWN0IHNpbXVsYXRvciB0byB1c2UsIGdpdmVuIHRoZSBkZXNpcmVkIGNhcGFiaWxpdGllc1xuICAgICAgY29uc3QgZGV2aWNlID0gYXdhaXQgZ2V0RXhpc3RpbmdTaW0odGhpcy5vcHRzKTtcblxuICAgICAgLy8gY2hlY2sgZm9yIGFuIGV4aXN0aW5nIHNpbXVsYXRvclxuICAgICAgaWYgKGRldmljZSkge1xuICAgICAgICByZXR1cm4ge2RldmljZSwgcmVhbERldmljZTogZmFsc2UsIHVkaWQ6IGRldmljZS51ZGlkfTtcbiAgICAgIH1cblxuICAgICAgbG9nLmluZm8oJ1NpbXVsYXRvciB1ZGlkIG5vdCBwcm92aWRlZCcpO1xuICAgIH1cblxuICAgIC8vIG5vIGRldmljZSBvZiB0aGlzIHR5cGUgZXhpc3RzLCBvciB0aGV5IHJlcXVlc3QgbmV3IHNpbSwgc28gY3JlYXRlIG9uZVxuICAgIGxvZy5pbmZvKCdVc2luZyBkZXNpcmVkIGNhcHMgdG8gY3JlYXRlIGEgbmV3IHNpbXVsYXRvcicpO1xuICAgIGNvbnN0IGRldmljZSA9IGF3YWl0IHRoaXMuY3JlYXRlU2ltKCk7XG4gICAgcmV0dXJuIHtkZXZpY2UsIHJlYWxEZXZpY2U6IGZhbHNlLCB1ZGlkOiBkZXZpY2UudWRpZH07XG4gIH1cblxuICBhc3luYyBzdGFydFNpbSAoKSB7XG4gICAgY29uc3QgcnVuT3B0cyA9IHtcbiAgICAgIHNjYWxlRmFjdG9yOiB0aGlzLm9wdHMuc2NhbGVGYWN0b3IsXG4gICAgICBjb25uZWN0SGFyZHdhcmVLZXlib2FyZDogISF0aGlzLm9wdHMuY29ubmVjdEhhcmR3YXJlS2V5Ym9hcmQsXG4gICAgICBpc0hlYWRsZXNzOiAhIXRoaXMub3B0cy5pc0hlYWRsZXNzLFxuICAgICAgZGV2aWNlUHJlZmVyZW5jZXM6IHt9LFxuICAgIH07XG5cbiAgICAvLyBhZGQgdGhlIHdpbmRvdyBjZW50ZXIsIGlmIGl0IGlzIHNwZWNpZmllZFxuICAgIGlmICh0aGlzLm9wdHMuU2ltdWxhdG9yV2luZG93Q2VudGVyKSB7XG4gICAgICBydW5PcHRzLmRldmljZVByZWZlcmVuY2VzLlNpbXVsYXRvcldpbmRvd0NlbnRlciA9IHRoaXMub3B0cy5TaW11bGF0b3JXaW5kb3dDZW50ZXI7XG4gICAgfVxuXG4gICAgLy8gVGhpcyBpcyB0byB3b3JrYXJvdW5kIFhDVGVzdCBidWcgYWJvdXQgY2hhbmdpbmcgU2ltdWxhdG9yXG4gICAgLy8gb3JpZW50YXRpb24gaXMgbm90IHN5bmNocm9uaXplZCB0byB0aGUgYWN0dWFsIHdpbmRvdyBvcmllbnRhdGlvblxuICAgIGNvbnN0IG9yaWVudGF0aW9uID0gXy5pc1N0cmluZyh0aGlzLm9wdHMub3JpZW50YXRpb24pICYmIHRoaXMub3B0cy5vcmllbnRhdGlvbi50b1VwcGVyQ2FzZSgpO1xuICAgIHN3aXRjaCAob3JpZW50YXRpb24pIHtcbiAgICAgIGNhc2UgJ0xBTkRTQ0FQRSc6XG4gICAgICAgIHJ1bk9wdHMuZGV2aWNlUHJlZmVyZW5jZXMuU2ltdWxhdG9yV2luZG93T3JpZW50YXRpb24gPSAnTGFuZHNjYXBlTGVmdCc7XG4gICAgICAgIHJ1bk9wdHMuZGV2aWNlUHJlZmVyZW5jZXMuU2ltdWxhdG9yV2luZG93Um90YXRpb25BbmdsZSA9IDkwO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1BPUlRSQUlUJzpcbiAgICAgICAgcnVuT3B0cy5kZXZpY2VQcmVmZXJlbmNlcy5TaW11bGF0b3JXaW5kb3dPcmllbnRhdGlvbiA9ICdQb3J0cmFpdCc7XG4gICAgICAgIHJ1bk9wdHMuZGV2aWNlUHJlZmVyZW5jZXMuU2ltdWxhdG9yV2luZG93Um90YXRpb25BbmdsZSA9IDA7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMub3B0cy5kZXZpY2UucnVuKHJ1bk9wdHMpO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlU2ltICgpIHtcbiAgICB0aGlzLmxpZmVjeWNsZURhdGEuY3JlYXRlU2ltID0gdHJ1ZTtcblxuICAgIC8vIEdldCBwbGF0Zm9ybSBuYW1lIGZyb20gY29uc3Qgc2luY2UgaXQgbXVzdCBiZSBjYXNlIHNlbnNpdGl2ZSB0byBjcmVhdGUgYSBuZXcgc2ltdWxhdG9yXG4gICAgY29uc3QgcGxhdGZvcm1OYW1lID0gaXNUdk9TKHRoaXMub3B0cy5wbGF0Zm9ybU5hbWUpID8gUExBVEZPUk1fTkFNRV9UVk9TIDogUExBVEZPUk1fTkFNRV9JT1M7XG5cbiAgICAvLyBjcmVhdGUgc2ltIGZvciBjYXBzXG4gICAgbGV0IHNpbSA9IGF3YWl0IGNyZWF0ZVNpbSh0aGlzLm9wdHMsIHBsYXRmb3JtTmFtZSk7XG4gICAgbG9nLmluZm8oYENyZWF0ZWQgc2ltdWxhdG9yIHdpdGggdWRpZCAnJHtzaW0udWRpZH0nLmApO1xuXG4gICAgcmV0dXJuIHNpbTtcbiAgfVxuXG4gIGFzeW5jIGxhdW5jaEFwcCAoKSB7XG4gICAgY29uc3QgQVBQX0xBVU5DSF9USU1FT1VUID0gMjAgKiAxMDAwO1xuXG4gICAgdGhpcy5sb2dFdmVudCgnYXBwTGF1bmNoQXR0ZW1wdGVkJyk7XG4gICAgYXdhaXQgbGF1bmNoKHRoaXMub3B0cy5kZXZpY2UudWRpZCwgdGhpcy5vcHRzLmJ1bmRsZUlkKTtcblxuICAgIGxldCBjaGVja1N0YXR1cyA9IGFzeW5jICgpID0+IHtcbiAgICAgIGxldCByZXNwb25zZSA9IGF3YWl0IHRoaXMucHJveHlDb21tYW5kKCcvc3RhdHVzJywgJ0dFVCcpO1xuICAgICAgbGV0IGN1cnJlbnRBcHAgPSByZXNwb25zZS5jdXJyZW50QXBwLmJ1bmRsZUlEO1xuICAgICAgaWYgKGN1cnJlbnRBcHAgIT09IHRoaXMub3B0cy5idW5kbGVJZCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5vcHRzLmJ1bmRsZUlkfSBub3QgaW4gZm9yZWdyb3VuZC4gJHtjdXJyZW50QXBwfSBpcyBpbiBmb3JlZ3JvdW5kYCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGxvZy5pbmZvKGBXYWl0aW5nIGZvciAnJHt0aGlzLm9wdHMuYnVuZGxlSWR9JyB0byBiZSBpbiBmb3JlZ3JvdW5kYCk7XG4gICAgbGV0IHJldHJpZXMgPSBwYXJzZUludChBUFBfTEFVTkNIX1RJTUVPVVQgLyAyMDAsIDEwKTtcbiAgICBhd2FpdCByZXRyeUludGVydmFsKHJldHJpZXMsIDIwMCwgY2hlY2tTdGF0dXMpO1xuICAgIGxvZy5pbmZvKGAke3RoaXMub3B0cy5idW5kbGVJZH0gaXMgaW4gZm9yZWdyb3VuZGApO1xuICAgIHRoaXMubG9nRXZlbnQoJ2FwcExhdW5jaGVkJyk7XG4gIH1cblxuICBhc3luYyBzdGFydFdkYVNlc3Npb24gKGJ1bmRsZUlkLCBwcm9jZXNzQXJndW1lbnRzKSB7XG4gICAgbGV0IGFyZ3MgPSBwcm9jZXNzQXJndW1lbnRzID8gKHByb2Nlc3NBcmd1bWVudHMuYXJncyB8fCBbXSkgOiBbXTtcbiAgICBpZiAoIV8uaXNBcnJheShhcmdzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBwcm9jZXNzQXJndW1lbnRzLmFyZ3MgY2FwYWJpbGl0eSBpcyBleHBlY3RlZCB0byBiZSBhbiBhcnJheS4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgYCR7SlNPTi5zdHJpbmdpZnkoYXJncyl9IGlzIGdpdmVuIGluc3RlYWRgKTtcbiAgICB9XG4gICAgbGV0IGVudiA9IHByb2Nlc3NBcmd1bWVudHMgPyAocHJvY2Vzc0FyZ3VtZW50cy5lbnYgfHwge30pIDoge307XG4gICAgaWYgKCFfLmlzUGxhaW5PYmplY3QoZW52KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBwcm9jZXNzQXJndW1lbnRzLmVudiBjYXBhYmlsaXR5IGlzIGV4cGVjdGVkIHRvIGJlIGEgZGljdGlvbmFyeS4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgYCR7SlNPTi5zdHJpbmdpZnkoZW52KX0gaXMgZ2l2ZW4gaW5zdGVhZGApO1xuICAgIH1cblxuICAgIGxldCBzaG91bGRXYWl0Rm9yUXVpZXNjZW5jZSA9IHV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLndhaXRGb3JRdWllc2NlbmNlKSA/IHRoaXMub3B0cy53YWl0Rm9yUXVpZXNjZW5jZSA6IHRydWU7XG4gICAgbGV0IG1heFR5cGluZ0ZyZXF1ZW5jeSA9IHV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLm1heFR5cGluZ0ZyZXF1ZW5jeSkgPyB0aGlzLm9wdHMubWF4VHlwaW5nRnJlcXVlbmN5IDogNjA7XG4gICAgbGV0IHNob3VsZFVzZVNpbmdsZXRvblRlc3RNYW5hZ2VyID0gdXRpbC5oYXNWYWx1ZSh0aGlzLm9wdHMuc2hvdWxkVXNlU2luZ2xldG9uVGVzdE1hbmFnZXIpID8gdGhpcy5vcHRzLnNob3VsZFVzZVNpbmdsZXRvblRlc3RNYW5hZ2VyIDogdHJ1ZTtcbiAgICBsZXQgc2hvdWxkVXNlVGVzdE1hbmFnZXJGb3JWaXNpYmlsaXR5RGV0ZWN0aW9uID0gZmFsc2U7XG4gICAgbGV0IGV2ZW50bG9vcElkbGVEZWxheVNlYyA9IHRoaXMub3B0cy53ZGFFdmVudGxvb3BJZGxlRGVsYXkgfHwgMDtcbiAgICBpZiAodXRpbC5oYXNWYWx1ZSh0aGlzLm9wdHMuc2ltcGxlSXNWaXNpYmxlQ2hlY2spKSB7XG4gICAgICBzaG91bGRVc2VUZXN0TWFuYWdlckZvclZpc2liaWxpdHlEZXRlY3Rpb24gPSB0aGlzLm9wdHMuc2ltcGxlSXNWaXNpYmxlQ2hlY2s7XG4gICAgfVxuICAgIC8vIFRPRE86IHBsYXRmb3JtVmVyc2lvbiBzaG91bGQgYmUgYSByZXF1aXJlZCBjYXBhYmlsaXR5XG4gICAgaWYgKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24gJiYgdXRpbC5jb21wYXJlVmVyc2lvbnModGhpcy5vcHRzLnBsYXRmb3JtVmVyc2lvbiwgJz09JywgJzkuMycpKSB7XG4gICAgICBsb2cuaW5mbyhgRm9yY2luZyBzaG91bGRVc2VTaW5nbGV0b25UZXN0TWFuYWdlciBjYXBhYmlsaXR5IHZhbHVlIHRvIHRydWUsIGJlY2F1c2Ugb2Yga25vd24gWENUZXN0IGlzc3VlcyB1bmRlciA5LjMgcGxhdGZvcm0gdmVyc2lvbmApO1xuICAgICAgc2hvdWxkVXNlVGVzdE1hbmFnZXJGb3JWaXNpYmlsaXR5RGV0ZWN0aW9uID0gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKHV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLmxhbmd1YWdlKSkge1xuICAgICAgYXJncy5wdXNoKCctQXBwbGVMYW5ndWFnZXMnLCBgKCR7dGhpcy5vcHRzLmxhbmd1YWdlfSlgKTtcbiAgICAgIGFyZ3MucHVzaCgnLU5TTGFuZ3VhZ2VzJywgYCgke3RoaXMub3B0cy5sYW5ndWFnZX0pYCk7XG4gICAgfVxuXG4gICAgaWYgKHV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLmxvY2FsZSkpIHtcbiAgICAgIGFyZ3MucHVzaCgnLUFwcGxlTG9jYWxlJywgdGhpcy5vcHRzLmxvY2FsZSk7XG4gICAgfVxuXG4gICAgbGV0IGRlc2lyZWQgPSB7XG4gICAgICBkZXNpcmVkQ2FwYWJpbGl0aWVzOiB7XG4gICAgICAgIGJ1bmRsZUlkLFxuICAgICAgICBhcmd1bWVudHM6IGFyZ3MsXG4gICAgICAgIGVudmlyb25tZW50OiBlbnYsXG4gICAgICAgIGV2ZW50bG9vcElkbGVEZWxheVNlYyxcbiAgICAgICAgc2hvdWxkV2FpdEZvclF1aWVzY2VuY2UsXG4gICAgICAgIHNob3VsZFVzZVRlc3RNYW5hZ2VyRm9yVmlzaWJpbGl0eURldGVjdGlvbixcbiAgICAgICAgbWF4VHlwaW5nRnJlcXVlbmN5LFxuICAgICAgICBzaG91bGRVc2VTaW5nbGV0b25UZXN0TWFuYWdlcixcbiAgICAgIH1cbiAgICB9O1xuICAgIGlmICh1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5zaG91bGRVc2VDb21wYWN0UmVzcG9uc2VzKSkge1xuICAgICAgZGVzaXJlZC5kZXNpcmVkQ2FwYWJpbGl0aWVzLnNob3VsZFVzZUNvbXBhY3RSZXNwb25zZXMgPSB0aGlzLm9wdHMuc2hvdWxkVXNlQ29tcGFjdFJlc3BvbnNlcztcbiAgICB9XG4gICAgaWYgKHV0aWwuaGFzVmFsdWUodGhpcy5vcHRzLmVsZW1lbnRSZXNwb25zZUZpZWxkcykpIHtcbiAgICAgIGRlc2lyZWQuZGVzaXJlZENhcGFiaWxpdGllcy5lbGVtZW50UmVzcG9uc2VGaWVsZHMgPSB0aGlzLm9wdHMuZWxlbWVudFJlc3BvbnNlRmllbGRzO1xuICAgIH1cbiAgICBpZiAodGhpcy5vcHRzLmF1dG9BY2NlcHRBbGVydHMpIHtcbiAgICAgIGRlc2lyZWQuZGVzaXJlZENhcGFiaWxpdGllcy5kZWZhdWx0QWxlcnRBY3Rpb24gPSAnYWNjZXB0JztcbiAgICB9IGVsc2UgaWYgKHRoaXMub3B0cy5hdXRvRGlzbWlzc0FsZXJ0cykge1xuICAgICAgZGVzaXJlZC5kZXNpcmVkQ2FwYWJpbGl0aWVzLmRlZmF1bHRBbGVydEFjdGlvbiA9ICdkaXNtaXNzJztcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL3Nlc3Npb24nLCAnUE9TVCcsIGRlc2lyZWQpO1xuICB9XG5cbiAgLy8gT3ZlcnJpZGUgUHJveHkgbWV0aG9kcyBmcm9tIEJhc2VEcml2ZXJcbiAgcHJveHlBY3RpdmUgKCkge1xuICAgIHJldHVybiB0aGlzLmp3cFByb3h5QWN0aXZlO1xuICB9XG5cbiAgZ2V0UHJveHlBdm9pZExpc3QgKCkge1xuICAgIGlmICh0aGlzLmlzV2VidmlldygpKSB7XG4gICAgICByZXR1cm4gTk9fUFJPWFlfV0VCX0xJU1Q7XG4gICAgfVxuICAgIHJldHVybiBOT19QUk9YWV9OQVRJVkVfTElTVDtcbiAgfVxuXG4gIGNhblByb3h5ICgpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGlzU2FmYXJpICgpIHtcbiAgICByZXR1cm4gISF0aGlzLnNhZmFyaTtcbiAgfVxuXG4gIGlzUmVhbERldmljZSAoKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0cy5yZWFsRGV2aWNlO1xuICB9XG5cbiAgaXNTaW11bGF0b3IgKCkge1xuICAgIHJldHVybiAhdGhpcy5vcHRzLnJlYWxEZXZpY2U7XG4gIH1cblxuICBpc1dlYnZpZXcgKCkge1xuICAgIHJldHVybiB0aGlzLmlzU2FmYXJpKCkgfHwgdGhpcy5pc1dlYkNvbnRleHQoKTtcbiAgfVxuXG4gIHZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5IChzdHJhdGVneSkge1xuICAgIHN1cGVyLnZhbGlkYXRlTG9jYXRvclN0cmF0ZWd5KHN0cmF0ZWd5LCB0aGlzLmlzV2ViQ29udGV4dCgpKTtcbiAgfVxuXG4gIHZhbGlkYXRlRGVzaXJlZENhcHMgKGNhcHMpIHtcbiAgICBpZiAoIXN1cGVyLnZhbGlkYXRlRGVzaXJlZENhcHMoY2FwcykpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICAvLyBtYWtlIHN1cmUgdGhhdCB0aGUgY2FwYWJpbGl0aWVzIGhhdmUgb25lIG9mIGBhcHBgIG9yIGBidW5kbGVJZGBcbiAgICBpZiAoKGNhcHMuYnJvd3Nlck5hbWUgfHwgJycpLnRvTG93ZXJDYXNlKCkgIT09ICdzYWZhcmknICYmICFjYXBzLmFwcCAmJiAhY2Fwcy5idW5kbGVJZCkge1xuICAgICAgbGV0IG1zZyA9ICdUaGUgZGVzaXJlZCBjYXBhYmlsaXRpZXMgbXVzdCBpbmNsdWRlIGVpdGhlciBhbiBhcHAgb3IgYSBidW5kbGVJZCBmb3IgaU9TJztcbiAgICAgIGxvZy5lcnJvckFuZFRocm93KG1zZyk7XG4gICAgfVxuXG4gICAgaWYgKCF1dGlsLmNvZXJjZVZlcnNpb24oY2Fwcy5wbGF0Zm9ybVZlcnNpb24sIGZhbHNlKSkge1xuICAgICAgbG9nLndhcm4oYCdwbGF0Zm9ybVZlcnNpb24nIGNhcGFiaWxpdHkgKCcke2NhcHMucGxhdGZvcm1WZXJzaW9ufScpIGlzIG5vdCBhIHZhbGlkIHZlcnNpb24gbnVtYmVyLiBgICtcbiAgICAgICAgYENvbnNpZGVyIGZpeGluZyBpdCBvciBiZSByZWFkeSB0byBleHBlcmllbmNlIGFuIGluY29uc2lzdGVudCBkcml2ZXIgYmVoYXZpb3IuYCk7XG4gICAgfVxuXG4gICAgbGV0IHZlcmlmeVByb2Nlc3NBcmd1bWVudCA9IChwcm9jZXNzQXJndW1lbnRzKSA9PiB7XG4gICAgICBjb25zdCB7YXJncywgZW52fSA9IHByb2Nlc3NBcmd1bWVudHM7XG4gICAgICBpZiAoIV8uaXNOaWwoYXJncykgJiYgIV8uaXNBcnJheShhcmdzKSkge1xuICAgICAgICBsb2cuZXJyb3JBbmRUaHJvdygncHJvY2Vzc0FyZ3VtZW50cy5hcmdzIG11c3QgYmUgYW4gYXJyYXkgb2Ygc3RyaW5ncycpO1xuICAgICAgfVxuICAgICAgaWYgKCFfLmlzTmlsKGVudikgJiYgIV8uaXNQbGFpbk9iamVjdChlbnYpKSB7XG4gICAgICAgIGxvZy5lcnJvckFuZFRocm93KCdwcm9jZXNzQXJndW1lbnRzLmVudiBtdXN0IGJlIGFuIG9iamVjdCA8a2V5LHZhbHVlPiBwYWlyIHthOmIsIGM6ZH0nKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gYHByb2Nlc3NBcmd1bWVudHNgIHNob3VsZCBiZSBKU09OIHN0cmluZyBvciBhbiBvYmplY3Qgd2l0aCBhcmd1bWVudHMgYW5kLyBlbnZpcm9ubWVudCBkZXRhaWxzXG4gICAgaWYgKGNhcHMucHJvY2Vzc0FyZ3VtZW50cykge1xuICAgICAgaWYgKF8uaXNTdHJpbmcoY2Fwcy5wcm9jZXNzQXJndW1lbnRzKSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIC8vIHRyeSB0byBwYXJzZSB0aGUgc3RyaW5nIGFzIEpTT05cbiAgICAgICAgICBjYXBzLnByb2Nlc3NBcmd1bWVudHMgPSBKU09OLnBhcnNlKGNhcHMucHJvY2Vzc0FyZ3VtZW50cyk7XG4gICAgICAgICAgdmVyaWZ5UHJvY2Vzc0FyZ3VtZW50KGNhcHMucHJvY2Vzc0FyZ3VtZW50cyk7XG4gICAgICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgICAgIGxvZy5lcnJvckFuZFRocm93KGBwcm9jZXNzQXJndW1lbnRzIG11c3QgYmUgYSBqc29uIGZvcm1hdCBvciBhbiBvYmplY3Qgd2l0aCBmb3JtYXQge2FyZ3MgOiBbXSwgZW52IDoge2E6YiwgYzpkfX0uIGAgK1xuICAgICAgICAgICAgYEJvdGggZW52aXJvbm1lbnQgYW5kIGFyZ3VtZW50IGNhbiBiZSBudWxsLiBFcnJvcjogJHtlcnJ9YCk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoXy5pc1BsYWluT2JqZWN0KGNhcHMucHJvY2Vzc0FyZ3VtZW50cykpIHtcbiAgICAgICAgdmVyaWZ5UHJvY2Vzc0FyZ3VtZW50KGNhcHMucHJvY2Vzc0FyZ3VtZW50cyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBsb2cuZXJyb3JBbmRUaHJvdyhgJ3Byb2Nlc3NBcmd1bWVudHMgbXVzdCBiZSBhbiBvYmplY3QsIG9yIGEgc3RyaW5nIEpTT04gb2JqZWN0IHdpdGggZm9ybWF0IHthcmdzIDogW10sIGVudiA6IHthOmIsIGM6ZH19LiBgICtcbiAgICAgICAgICBgQm90aCBlbnZpcm9ubWVudCBhbmQgYXJndW1lbnQgY2FuIGJlIG51bGwuYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gdGhlcmUgaXMgbm8gcG9pbnQgaW4gaGF2aW5nIGBrZXljaGFpblBhdGhgIHdpdGhvdXQgYGtleWNoYWluUGFzc3dvcmRgXG4gICAgaWYgKChjYXBzLmtleWNoYWluUGF0aCAmJiAhY2Fwcy5rZXljaGFpblBhc3N3b3JkKSB8fCAoIWNhcHMua2V5Y2hhaW5QYXRoICYmIGNhcHMua2V5Y2hhaW5QYXNzd29yZCkpIHtcbiAgICAgIGxvZy5lcnJvckFuZFRocm93KGBJZiAna2V5Y2hhaW5QYXRoJyBpcyBzZXQsICdrZXljaGFpblBhc3N3b3JkJyBtdXN0IGFsc28gYmUgc2V0IChhbmQgdmljZSB2ZXJzYSkuYCk7XG4gICAgfVxuXG4gICAgLy8gYHJlc2V0T25TZXNzaW9uU3RhcnRPbmx5YCBzaG91bGQgYmUgc2V0IHRvIHRydWUgYnkgZGVmYXVsdFxuICAgIHRoaXMub3B0cy5yZXNldE9uU2Vzc2lvblN0YXJ0T25seSA9ICF1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5yZXNldE9uU2Vzc2lvblN0YXJ0T25seSkgfHwgdGhpcy5vcHRzLnJlc2V0T25TZXNzaW9uU3RhcnRPbmx5O1xuICAgIHRoaXMub3B0cy51c2VOZXdXREEgPSB1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy51c2VOZXdXREEpID8gdGhpcy5vcHRzLnVzZU5ld1dEQSA6IGZhbHNlO1xuXG4gICAgaWYgKGNhcHMuY29tbWFuZFRpbWVvdXRzKSB7XG4gICAgICBjYXBzLmNvbW1hbmRUaW1lb3V0cyA9IG5vcm1hbGl6ZUNvbW1hbmRUaW1lb3V0cyhjYXBzLmNvbW1hbmRUaW1lb3V0cyk7XG4gICAgfVxuXG4gICAgaWYgKF8uaXNTdHJpbmcoY2Fwcy53ZWJEcml2ZXJBZ2VudFVybCkpIHtcbiAgICAgIGNvbnN0IHtwcm90b2NvbCwgaG9zdH0gPSB1cmwucGFyc2UoY2Fwcy53ZWJEcml2ZXJBZ2VudFVybCk7XG4gICAgICBpZiAoXy5pc0VtcHR5KHByb3RvY29sKSB8fCBfLmlzRW1wdHkoaG9zdCkpIHtcbiAgICAgICAgbG9nLmVycm9yQW5kVGhyb3coYCd3ZWJEcml2ZXJBZ2VudFVybCcgY2FwYWJpbGl0eSBpcyBleHBlY3RlZCB0byBjb250YWluIGEgdmFsaWQgV2ViRHJpdmVyQWdlbnQgc2VydmVyIFVSTC4gYCArXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGAnJHtjYXBzLndlYkRyaXZlckFnZW50VXJsfScgaXMgZ2l2ZW4gaW5zdGVhZGApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjYXBzLmJyb3dzZXJOYW1lKSB7XG4gICAgICBpZiAoY2Fwcy5idW5kbGVJZCkge1xuICAgICAgICBsb2cuZXJyb3JBbmRUaHJvdyhgJ2Jyb3dzZXJOYW1lJyBjYW5ub3QgYmUgc2V0IHRvZ2V0aGVyIHdpdGggJ2J1bmRsZUlkJyBjYXBhYmlsaXR5YCk7XG4gICAgICB9XG4gICAgICAvLyB3YXJuIGlmIHRoZSBjYXBhYmlsaXRpZXMgaGF2ZSBib3RoIGBhcHBgIGFuZCBgYnJvd3NlciwgYWx0aG91Z2ggdGhpc1xuICAgICAgLy8gaXMgY29tbW9uIHdpdGggc2VsZW5pdW0gZ3JpZFxuICAgICAgaWYgKGNhcHMuYXBwKSB7XG4gICAgICAgIGxvZy53YXJuKGBUaGUgY2FwYWJpbGl0aWVzIHNob3VsZCBnZW5lcmFsbHkgbm90IGluY2x1ZGUgYm90aCBhbiAnYXBwJyBhbmQgYSAnYnJvd3Nlck5hbWUnYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNhcHMucGVybWlzc2lvbnMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGZvciAoY29uc3QgW2J1bmRsZUlkLCBwZXJtc10gb2YgXy50b1BhaXJzKEpTT04ucGFyc2UoY2Fwcy5wZXJtaXNzaW9ucykpKSB7XG4gICAgICAgICAgaWYgKCFfLmlzU3RyaW5nKGJ1bmRsZUlkKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnJHtKU09OLnN0cmluZ2lmeShidW5kbGVJZCl9JyBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICghXy5pc1BsYWluT2JqZWN0KHBlcm1zKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGAnJHtKU09OLnN0cmluZ2lmeShwZXJtcyl9JyBtdXN0IGJlIGEgSlNPTiBvYmplY3RgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgbG9nLmVycm9yQW5kVGhyb3coYCcke2NhcHMucGVybWlzc2lvbnN9JyBpcyBleHBlY3RlZCB0byBiZSBhIHZhbGlkIG9iamVjdCB3aXRoIGZvcm1hdCBgICtcbiAgICAgICAgICBge1wiPGJ1bmRsZUlkMT5cIjoge1wiPHNlcnZpY2VOYW1lMT5cIjogXCI8c2VydmljZVN0YXR1czE+XCIsIC4uLn0sIC4uLn0uIE9yaWdpbmFsIGVycm9yOiAke2UubWVzc2FnZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBmaW5hbGx5LCByZXR1cm4gdHJ1ZSBzaW5jZSB0aGUgc3VwZXJjbGFzcyBjaGVjayBwYXNzZWQsIGFzIGRpZCB0aGlzXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBhc3luYyBpbnN0YWxsQVVUICgpIHtcbiAgICBpZiAodGhpcy5pc1NhZmFyaSgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIGlmIHVzZXIgaGFzIHBhc3NlZCBpbiBkZXNpcmVkQ2Fwcy5hdXRvTGF1bmNoID0gZmFsc2VcbiAgICAvLyBtZWFuaW5nIHRoZXkgd2lsbCBtYW5hZ2UgYXBwIGluc3RhbGwgLyBsYXVuY2hpbmdcbiAgICBpZiAodGhpcy5vcHRzLmF1dG9MYXVuY2ggPT09IGZhbHNlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHZlcmlmeUFwcGxpY2F0aW9uUGxhdGZvcm0odGhpcy5vcHRzLmFwcCwgdGhpcy5pc1NpbXVsYXRvcigpKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIC8vIFRPRE86IExldCBpdCB0aHJvdyBhZnRlciB3ZSBjb25maXJtIHRoZSBhcmNoaXRlY3R1cmUgdmVyaWZpY2F0aW9uIGFsZ29yaXRobSBpcyBzdGFibGVcbiAgICAgIGxvZy53YXJuKGAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipgKTtcbiAgICAgIGxvZy53YXJuKGAke3RoaXMuaXNTaW11bGF0b3IoKSA/ICdTaW11bGF0b3InIDogJ1JlYWwgZGV2aWNlJ30gYXJjaGl0ZWN0dXJlIGFwcGVhcnMgdG8gYmUgdW5zdXBwb3J0ZWQgYCArXG4gICAgICAgICAgICAgICBgYnkgdGhlICcke3RoaXMub3B0cy5hcHB9JyBhcHBsaWNhdGlvbi4gYCArXG4gICAgICAgICAgICAgICBgTWFrZSBzdXJlIHRoZSBjb3JyZWN0IGRlcGxveW1lbnQgdGFyZ2V0IGhhcyBiZWVuIHNlbGVjdGVkIGZvciBpdHMgY29tcGlsYXRpb24gaW4gWGNvZGUuYCk7XG4gICAgICBsb2cud2FybignRG9uXFwndCBiZSBzdXJwcmlzZWQgaWYgdGhlIGFwcGxpY2F0aW9uIGZhaWxzIHRvIGxhdW5jaC4nKTtcbiAgICAgIGxvZy53YXJuKGAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipgKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5pc1JlYWxEZXZpY2UoKSkge1xuICAgICAgYXdhaXQgaW5zdGFsbFRvUmVhbERldmljZSh0aGlzLm9wdHMuZGV2aWNlLCB0aGlzLm9wdHMuYXBwLCB0aGlzLm9wdHMuYnVuZGxlSWQsIHRoaXMub3B0cy5ub1Jlc2V0KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgaW5zdGFsbFRvU2ltdWxhdG9yKHRoaXMub3B0cy5kZXZpY2UsIHRoaXMub3B0cy5hcHAsIHRoaXMub3B0cy5idW5kbGVJZCwgdGhpcy5vcHRzLm5vUmVzZXQpO1xuICAgIH1cblxuICAgIGlmICh1dGlsLmhhc1ZhbHVlKHRoaXMub3B0cy5pb3NJbnN0YWxsUGF1c2UpKSB7XG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXBwaXVtL2FwcGl1bS9pc3N1ZXMvNjg4OVxuICAgICAgbGV0IHBhdXNlID0gcGFyc2VJbnQodGhpcy5vcHRzLmlvc0luc3RhbGxQYXVzZSwgMTApO1xuICAgICAgbG9nLmRlYnVnKGBpb3NJbnN0YWxsUGF1c2Ugc2V0LiBQYXVzaW5nICR7cGF1c2V9IG1zIGJlZm9yZSBjb250aW51aW5nYCk7XG4gICAgICBhd2FpdCBCLmRlbGF5KHBhdXNlKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzZXRJbml0aWFsT3JpZW50YXRpb24gKG9yaWVudGF0aW9uKSB7XG4gICAgaWYgKCFfLmlzU3RyaW5nKG9yaWVudGF0aW9uKSkge1xuICAgICAgbG9nLmluZm8oJ1NraXBwaW5nIHNldHRpbmcgb2YgdGhlIGluaXRpYWwgZGlzcGxheSBvcmllbnRhdGlvbi4gJyArXG4gICAgICAgICdTZXQgdGhlIFwib3JpZW50YXRpb25cIiBjYXBhYmlsaXR5IHRvIGVpdGhlciBcIkxBTkRTQ0FQRVwiIG9yIFwiUE9SVFJBSVRcIiwgaWYgdGhpcyBpcyBhbiB1bmRlc2lyZWQgYmVoYXZpb3IuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG9yaWVudGF0aW9uID0gb3JpZW50YXRpb24udG9VcHBlckNhc2UoKTtcbiAgICBpZiAoIV8uaW5jbHVkZXMoWydMQU5EU0NBUEUnLCAnUE9SVFJBSVQnXSwgb3JpZW50YXRpb24pKSB7XG4gICAgICBsb2cuZGVidWcoYFVuYWJsZSB0byBzZXQgaW5pdGlhbCBvcmllbnRhdGlvbiB0byAnJHtvcmllbnRhdGlvbn0nYCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGxvZy5kZWJ1ZyhgU2V0dGluZyBpbml0aWFsIG9yaWVudGF0aW9uIHRvICcke29yaWVudGF0aW9ufSdgKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5wcm94eUNvbW1hbmQoJy9vcmllbnRhdGlvbicsICdQT1NUJywge29yaWVudGF0aW9ufSk7XG4gICAgICB0aGlzLm9wdHMuY3VyT3JpZW50YXRpb24gPSBvcmllbnRhdGlvbjtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGxvZy53YXJuKGBTZXR0aW5nIGluaXRpYWwgb3JpZW50YXRpb24gZmFpbGVkIHdpdGg6ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9XG5cbiAgX2dldENvbW1hbmRUaW1lb3V0IChjbWROYW1lKSB7XG4gICAgaWYgKHRoaXMub3B0cy5jb21tYW5kVGltZW91dHMpIHtcbiAgICAgIGlmIChjbWROYW1lICYmIF8uaGFzKHRoaXMub3B0cy5jb21tYW5kVGltZW91dHMsIGNtZE5hbWUpKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wdHMuY29tbWFuZFRpbWVvdXRzW2NtZE5hbWVdO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMub3B0cy5jb21tYW5kVGltZW91dHNbREVGQVVMVF9USU1FT1VUX0tFWV07XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEdldCBzZXNzaW9uIGNhcGFiaWxpdGllcyBtZXJnZWQgd2l0aCB3aGF0IFdEQSByZXBvcnRzXG4gICAqIFRoaXMgaXMgYSBsaWJyYXJ5IGNvbW1hbmQgYnV0IG5lZWRzIHRvIGNhbGwgJ3N1cGVyJyBzbyBjYW4ndCBiZSBvblxuICAgKiBhIGhlbHBlciBvYmplY3RcbiAgICovXG4gIGFzeW5jIGdldFNlc3Npb24gKCkge1xuICAgIC8vIGNhbGwgc3VwZXIgdG8gZ2V0IGV2ZW50IHRpbWluZ3MsIGV0Yy4uLlxuICAgIGNvbnN0IGRyaXZlclNlc3Npb24gPSBhd2FpdCBzdXBlci5nZXRTZXNzaW9uKCk7XG4gICAgaWYgKCF0aGlzLndkYUNhcHMpIHtcbiAgICAgIHRoaXMud2RhQ2FwcyA9IGF3YWl0IHRoaXMucHJveHlDb21tYW5kKCcvJywgJ0dFVCcpO1xuICAgIH1cbiAgICBpZiAoIXRoaXMuZGV2aWNlQ2Fwcykge1xuICAgICAgY29uc3Qge3N0YXR1c0JhclNpemUsIHNjYWxlfSA9IGF3YWl0IHRoaXMuZ2V0U2NyZWVuSW5mbygpO1xuICAgICAgdGhpcy5kZXZpY2VDYXBzID0ge1xuICAgICAgICBwaXhlbFJhdGlvOiBzY2FsZSxcbiAgICAgICAgc3RhdEJhckhlaWdodDogc3RhdHVzQmFyU2l6ZS5oZWlnaHQsXG4gICAgICAgIHZpZXdwb3J0UmVjdDogYXdhaXQgdGhpcy5nZXRWaWV3cG9ydFJlY3QoKSxcbiAgICAgIH07XG4gICAgfVxuICAgIGxvZy5pbmZvKCdNZXJnaW5nIFdEQSBjYXBzIG92ZXIgQXBwaXVtIGNhcHMgZm9yIHNlc3Npb24gZGV0YWlsIHJlc3BvbnNlJyk7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe3VkaWQ6IHRoaXMub3B0cy51ZGlkfSwgZHJpdmVyU2Vzc2lvbixcbiAgICAgIHRoaXMud2RhQ2Fwcy5jYXBhYmlsaXRpZXMsIHRoaXMuZGV2aWNlQ2Fwcyk7XG4gIH1cblxuICBhc3luYyBzdGFydElXRFAgKCkge1xuICAgIHRoaXMubG9nRXZlbnQoJ2l3ZHBTdGFydGluZycpO1xuICAgIHRoaXMuaXdkcFNlcnZlciA9IG5ldyBJV0RQKHtcbiAgICAgIHdlYmtpdERlYnVnUHJveHlQb3J0OiB0aGlzLm9wdHMud2Via2l0RGVidWdQcm94eVBvcnQsXG4gICAgICB1ZGlkOiB0aGlzLm9wdHMudWRpZCxcbiAgICAgIGxvZ1N0ZG91dDogISF0aGlzLm9wdHMuc2hvd0lXRFBMb2csXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5pd2RwU2VydmVyLnN0YXJ0KCk7XG4gICAgdGhpcy5sb2dFdmVudCgnaXdkcFN0YXJ0ZWQnKTtcbiAgfVxuXG4gIGFzeW5jIHN0b3BJV0RQICgpIHtcbiAgICBpZiAodGhpcy5pd2RwU2VydmVyKSB7XG4gICAgICBhd2FpdCB0aGlzLml3ZHBTZXJ2ZXIuc3RvcCgpO1xuICAgICAgZGVsZXRlIHRoaXMuaXdkcFNlcnZlcjtcbiAgICB9XG4gIH1cblxuICBhc3luYyByZXNldCAoKSB7XG4gICAgaWYgKHRoaXMub3B0cy5ub1Jlc2V0KSB7XG4gICAgICAvLyBUaGlzIGlzIHRvIG1ha2Ugc3VyZSByZXNldCBoYXBwZW5zIGV2ZW4gaWYgbm9SZXNldCBpcyBzZXQgdG8gdHJ1ZVxuICAgICAgbGV0IG9wdHMgPSBfLmNsb25lRGVlcCh0aGlzLm9wdHMpO1xuICAgICAgb3B0cy5ub1Jlc2V0ID0gZmFsc2U7XG4gICAgICBvcHRzLmZ1bGxSZXNldCA9IGZhbHNlO1xuICAgICAgY29uc3Qgc2h1dGRvd25IYW5kbGVyID0gdGhpcy5yZXNldE9uVW5leHBlY3RlZFNodXRkb3duO1xuICAgICAgdGhpcy5yZXNldE9uVW5leHBlY3RlZFNodXRkb3duID0gKCkgPT4ge307XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCB0aGlzLnJ1blJlc2V0KG9wdHMpO1xuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5yZXNldE9uVW5leHBlY3RlZFNodXRkb3duID0gc2h1dGRvd25IYW5kbGVyO1xuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCBzdXBlci5yZXNldCgpO1xuICB9XG59XG5cbk9iamVjdC5hc3NpZ24oWENVSVRlc3REcml2ZXIucHJvdG90eXBlLCBjb21tYW5kcyk7XG5cbmV4cG9ydCBkZWZhdWx0IFhDVUlUZXN0RHJpdmVyO1xuZXhwb3J0IHsgWENVSVRlc3REcml2ZXIgfTtcbiJdLCJmaWxlIjoibGliL2RyaXZlci5qcyIsInNvdXJjZVJvb3QiOiIuLi8uLiJ9
