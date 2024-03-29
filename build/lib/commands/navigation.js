"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault");

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.helpers = exports.commands = void 0;

require("source-map-support/register");

var _appiumBaseDriver = require("appium-base-driver");

var _appiumSupport = require("appium-support");

var _lodash = _interopRequireDefault(require("lodash"));

var _logger = _interopRequireDefault(require("../logger"));

let commands = {},
    helpers = {},
    extensions = {};
exports.helpers = helpers;
exports.commands = commands;

commands.back = async function back() {
  if (!this.isWebContext()) {
    await this.nativeBack();
  } else {
    await this.mobileWebNav('back');
  }
};

helpers.nativeBack = async function nativeBack() {
  try {
    let navBar = await this.findNativeElementOrElements('class name', 'XCUIElementTypeNavigationBar', false);
    let buttons = await this.findNativeElementOrElements('class name', 'XCUIElementTypeButton', true, navBar);

    if (buttons.length === 0) {
      throw new Error('No buttons found in navigation bar');
    }

    let backButton = _lodash.default.filter(buttons, value => value.label === 'Back')[0];

    if (backButton) {
      _logger.default.debug(`Found navigation bar 'back' button. Clicking.`);
    } else {
      _logger.default.debug(`Unable to find 'Back' button. Trying first button in navigation bar`);

      backButton = buttons[0];
    }

    await this.nativeClick(backButton);
  } catch (err) {
    _logger.default.error(`Unable to find navigation bar and back button: ${err.message}`);
  }
};

commands.forward = async function forward() {
  if (!this.isWebContext()) {}

  await this.mobileWebNav('forward');
};

commands.closeWindow = async function closeWindow() {
  if (!this.isWebContext()) {
    throw new _appiumBaseDriver.errors.NotImplementedError();
  }

  let script = "return window.open('','_self').close();";

  if (_appiumSupport.util.compareVersions(this.opts.platformVersion, '>=', '12.2')) {
    script = `setTimeout(function () {window.open('','_self').close();}, 0); return true;`;
  }

  return await this.executeAtom('execute_script', [script, []], true);
};

Object.assign(extensions, commands, helpers);
var _default = extensions;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9jb21tYW5kcy9uYXZpZ2F0aW9uLmpzIl0sIm5hbWVzIjpbImNvbW1hbmRzIiwiaGVscGVycyIsImV4dGVuc2lvbnMiLCJiYWNrIiwiaXNXZWJDb250ZXh0IiwibmF0aXZlQmFjayIsIm1vYmlsZVdlYk5hdiIsIm5hdkJhciIsImZpbmROYXRpdmVFbGVtZW50T3JFbGVtZW50cyIsImJ1dHRvbnMiLCJsZW5ndGgiLCJFcnJvciIsImJhY2tCdXR0b24iLCJfIiwiZmlsdGVyIiwidmFsdWUiLCJsYWJlbCIsImxvZyIsImRlYnVnIiwibmF0aXZlQ2xpY2siLCJlcnIiLCJlcnJvciIsIm1lc3NhZ2UiLCJmb3J3YXJkIiwiY2xvc2VXaW5kb3ciLCJlcnJvcnMiLCJOb3RJbXBsZW1lbnRlZEVycm9yIiwic2NyaXB0IiwidXRpbCIsImNvbXBhcmVWZXJzaW9ucyIsIm9wdHMiLCJwbGF0Zm9ybVZlcnNpb24iLCJleGVjdXRlQXRvbSIsIk9iamVjdCIsImFzc2lnbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQTs7QUFDQTs7QUFDQTs7QUFDQTs7QUFHQSxJQUFJQSxRQUFRLEdBQUcsRUFBZjtBQUFBLElBQW1CQyxPQUFPLEdBQUcsRUFBN0I7QUFBQSxJQUFpQ0MsVUFBVSxHQUFHLEVBQTlDOzs7O0FBRUFGLFFBQVEsQ0FBQ0csSUFBVCxHQUFnQixlQUFlQSxJQUFmLEdBQXVCO0FBQ3JDLE1BQUksQ0FBQyxLQUFLQyxZQUFMLEVBQUwsRUFBMEI7QUFDeEIsVUFBTSxLQUFLQyxVQUFMLEVBQU47QUFDRCxHQUZELE1BRU87QUFDTCxVQUFNLEtBQUtDLFlBQUwsQ0FBa0IsTUFBbEIsQ0FBTjtBQUNEO0FBQ0YsQ0FORDs7QUFRQUwsT0FBTyxDQUFDSSxVQUFSLEdBQXFCLGVBQWVBLFVBQWYsR0FBNkI7QUFDaEQsTUFBSTtBQUNGLFFBQUlFLE1BQU0sR0FBRyxNQUFNLEtBQUtDLDJCQUFMLENBQWlDLFlBQWpDLEVBQStDLDhCQUEvQyxFQUErRSxLQUEvRSxDQUFuQjtBQUNBLFFBQUlDLE9BQU8sR0FBRyxNQUFNLEtBQUtELDJCQUFMLENBQWlDLFlBQWpDLEVBQStDLHVCQUEvQyxFQUF3RSxJQUF4RSxFQUE4RUQsTUFBOUUsQ0FBcEI7O0FBQ0EsUUFBSUUsT0FBTyxDQUFDQyxNQUFSLEtBQW1CLENBQXZCLEVBQTBCO0FBQ3hCLFlBQU0sSUFBSUMsS0FBSixDQUFVLG9DQUFWLENBQU47QUFDRDs7QUFFRCxRQUFJQyxVQUFVLEdBQUdDLGdCQUFFQyxNQUFGLENBQVNMLE9BQVQsRUFBbUJNLEtBQUQsSUFBV0EsS0FBSyxDQUFDQyxLQUFOLEtBQWdCLE1BQTdDLEVBQXFELENBQXJELENBQWpCOztBQUNBLFFBQUlKLFVBQUosRUFBZ0I7QUFDZEssc0JBQUlDLEtBQUosQ0FBVywrQ0FBWDtBQUNELEtBRkQsTUFFTztBQUNMRCxzQkFBSUMsS0FBSixDQUFXLHFFQUFYOztBQUNBTixNQUFBQSxVQUFVLEdBQUdILE9BQU8sQ0FBQyxDQUFELENBQXBCO0FBQ0Q7O0FBQ0QsVUFBTSxLQUFLVSxXQUFMLENBQWlCUCxVQUFqQixDQUFOO0FBQ0QsR0FmRCxDQWVFLE9BQU9RLEdBQVAsRUFBWTtBQUNaSCxvQkFBSUksS0FBSixDQUFXLGtEQUFpREQsR0FBRyxDQUFDRSxPQUFRLEVBQXhFO0FBQ0Q7QUFDRixDQW5CRDs7QUFxQkF0QixRQUFRLENBQUN1QixPQUFULEdBQW1CLGVBQWVBLE9BQWYsR0FBMEI7QUFDM0MsTUFBSSxDQUFDLEtBQUtuQixZQUFMLEVBQUwsRUFBMEIsQ0FDekI7O0FBQ0QsUUFBTSxLQUFLRSxZQUFMLENBQWtCLFNBQWxCLENBQU47QUFDRCxDQUpEOztBQU1BTixRQUFRLENBQUN3QixXQUFULEdBQXVCLGVBQWVBLFdBQWYsR0FBOEI7QUFDbkQsTUFBSSxDQUFDLEtBQUtwQixZQUFMLEVBQUwsRUFBMEI7QUFDeEIsVUFBTSxJQUFJcUIseUJBQU9DLG1CQUFYLEVBQU47QUFDRDs7QUFDRCxNQUFJQyxNQUFNLEdBQUcseUNBQWI7O0FBRUEsTUFBSUMsb0JBQUtDLGVBQUwsQ0FBcUIsS0FBS0MsSUFBTCxDQUFVQyxlQUEvQixFQUFnRCxJQUFoRCxFQUFzRCxNQUF0RCxDQUFKLEVBQW1FO0FBR2pFSixJQUFBQSxNQUFNLEdBQUksNkVBQVY7QUFDRDs7QUFDRCxTQUFPLE1BQU0sS0FBS0ssV0FBTCxDQUFpQixnQkFBakIsRUFBbUMsQ0FBQ0wsTUFBRCxFQUFTLEVBQVQsQ0FBbkMsRUFBaUQsSUFBakQsQ0FBYjtBQUNELENBWkQ7O0FBZUFNLE1BQU0sQ0FBQ0MsTUFBUCxDQUFjaEMsVUFBZCxFQUEwQkYsUUFBMUIsRUFBb0NDLE9BQXBDO2VBRWVDLFUiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBlcnJvcnMgfSBmcm9tICdhcHBpdW0tYmFzZS1kcml2ZXInO1xuaW1wb3J0IHsgdXRpbCB9IGZyb20gJ2FwcGl1bS1zdXBwb3J0JztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgbG9nIGZyb20gJy4uL2xvZ2dlcic7XG5cblxubGV0IGNvbW1hbmRzID0ge30sIGhlbHBlcnMgPSB7fSwgZXh0ZW5zaW9ucyA9IHt9O1xuXG5jb21tYW5kcy5iYWNrID0gYXN5bmMgZnVuY3Rpb24gYmFjayAoKSB7XG4gIGlmICghdGhpcy5pc1dlYkNvbnRleHQoKSkge1xuICAgIGF3YWl0IHRoaXMubmF0aXZlQmFjaygpO1xuICB9IGVsc2Uge1xuICAgIGF3YWl0IHRoaXMubW9iaWxlV2ViTmF2KCdiYWNrJyk7XG4gIH1cbn07XG5cbmhlbHBlcnMubmF0aXZlQmFjayA9IGFzeW5jIGZ1bmN0aW9uIG5hdGl2ZUJhY2sgKCkge1xuICB0cnkge1xuICAgIGxldCBuYXZCYXIgPSBhd2FpdCB0aGlzLmZpbmROYXRpdmVFbGVtZW50T3JFbGVtZW50cygnY2xhc3MgbmFtZScsICdYQ1VJRWxlbWVudFR5cGVOYXZpZ2F0aW9uQmFyJywgZmFsc2UpO1xuICAgIGxldCBidXR0b25zID0gYXdhaXQgdGhpcy5maW5kTmF0aXZlRWxlbWVudE9yRWxlbWVudHMoJ2NsYXNzIG5hbWUnLCAnWENVSUVsZW1lbnRUeXBlQnV0dG9uJywgdHJ1ZSwgbmF2QmFyKTtcbiAgICBpZiAoYnV0dG9ucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignTm8gYnV0dG9ucyBmb3VuZCBpbiBuYXZpZ2F0aW9uIGJhcicpO1xuICAgIH1cblxuICAgIGxldCBiYWNrQnV0dG9uID0gXy5maWx0ZXIoYnV0dG9ucywgKHZhbHVlKSA9PiB2YWx1ZS5sYWJlbCA9PT0gJ0JhY2snKVswXTtcbiAgICBpZiAoYmFja0J1dHRvbikge1xuICAgICAgbG9nLmRlYnVnKGBGb3VuZCBuYXZpZ2F0aW9uIGJhciAnYmFjaycgYnV0dG9uLiBDbGlja2luZy5gKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nLmRlYnVnKGBVbmFibGUgdG8gZmluZCAnQmFjaycgYnV0dG9uLiBUcnlpbmcgZmlyc3QgYnV0dG9uIGluIG5hdmlnYXRpb24gYmFyYCk7XG4gICAgICBiYWNrQnV0dG9uID0gYnV0dG9uc1swXTtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5uYXRpdmVDbGljayhiYWNrQnV0dG9uKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgbG9nLmVycm9yKGBVbmFibGUgdG8gZmluZCBuYXZpZ2F0aW9uIGJhciBhbmQgYmFjayBidXR0b246ICR7ZXJyLm1lc3NhZ2V9YCk7XG4gIH1cbn07XG5cbmNvbW1hbmRzLmZvcndhcmQgPSBhc3luYyBmdW5jdGlvbiBmb3J3YXJkICgpIHtcbiAgaWYgKCF0aGlzLmlzV2ViQ29udGV4dCgpKSB7XG4gIH1cbiAgYXdhaXQgdGhpcy5tb2JpbGVXZWJOYXYoJ2ZvcndhcmQnKTtcbn07XG5cbmNvbW1hbmRzLmNsb3NlV2luZG93ID0gYXN5bmMgZnVuY3Rpb24gY2xvc2VXaW5kb3cgKCkge1xuICBpZiAoIXRoaXMuaXNXZWJDb250ZXh0KCkpIHtcbiAgICB0aHJvdyBuZXcgZXJyb3JzLk5vdEltcGxlbWVudGVkRXJyb3IoKTtcbiAgfVxuICBsZXQgc2NyaXB0ID0gXCJyZXR1cm4gd2luZG93Lm9wZW4oJycsJ19zZWxmJykuY2xvc2UoKTtcIjtcbiAgLy8gVE9ETzogcGxhdGZvcm1WZXJzaW9uIHNob3VsZCBiZSBhIHJlcXVpcmVkIGNhcGFiaWxpdHlcbiAgaWYgKHV0aWwuY29tcGFyZVZlcnNpb25zKHRoaXMub3B0cy5wbGF0Zm9ybVZlcnNpb24sICc+PScsICcxMi4yJykpIHtcbiAgICAvLyBvbiAxMi4yIHRoZSB3aG9sZSBtZXNzYWdlIGlzIGV2YWx1YXRlZCBpbiB0aGUgY29udGV4dCBvZiB0aGUgcGFnZSxcbiAgICAvLyB3aGljaCBpcyBjbG9zZWQgYW5kIHNvIG5ldmVyIHJldHVybnNcbiAgICBzY3JpcHQgPSBgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7d2luZG93Lm9wZW4oJycsJ19zZWxmJykuY2xvc2UoKTt9LCAwKTsgcmV0dXJuIHRydWU7YDtcbiAgfVxuICByZXR1cm4gYXdhaXQgdGhpcy5leGVjdXRlQXRvbSgnZXhlY3V0ZV9zY3JpcHQnLCBbc2NyaXB0LCBbXV0sIHRydWUpO1xufTtcblxuXG5PYmplY3QuYXNzaWduKGV4dGVuc2lvbnMsIGNvbW1hbmRzLCBoZWxwZXJzKTtcbmV4cG9ydCB7IGNvbW1hbmRzLCBoZWxwZXJzIH07XG5leHBvcnQgZGVmYXVsdCBleHRlbnNpb25zO1xuIl0sImZpbGUiOiJsaWIvY29tbWFuZHMvbmF2aWdhdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIuLi8uLi8uLiJ9
