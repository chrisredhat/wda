"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = exports.commands = void 0;

require("source-map-support/register");

let extensions = {},
    commands = {};
exports.commands = commands;

commands.setClipboard = async function setClipboard(content, contentType) {
  await this.proxyCommand('/wda/setPasteboard', 'POST', {
    content,
    contentType
  });
};

commands.getClipboard = async function getClipboard(contentType) {
  return await this.proxyCommand('/wda/getPasteboard', 'POST', {
    contentType
  });
};

Object.assign(extensions, commands);
var _default = extensions;
exports.default = _default;require('source-map-support').install();


//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImxpYi9jb21tYW5kcy9jbGlwYm9hcmQuanMiXSwibmFtZXMiOlsiZXh0ZW5zaW9ucyIsImNvbW1hbmRzIiwic2V0Q2xpcGJvYXJkIiwiY29udGVudCIsImNvbnRlbnRUeXBlIiwicHJveHlDb21tYW5kIiwiZ2V0Q2xpcGJvYXJkIiwiT2JqZWN0IiwiYXNzaWduIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSxJQUFJQSxVQUFVLEdBQUcsRUFBakI7QUFBQSxJQUFxQkMsUUFBUSxHQUFHLEVBQWhDOzs7QUFVQUEsUUFBUSxDQUFDQyxZQUFULEdBQXdCLGVBQWVBLFlBQWYsQ0FBNkJDLE9BQTdCLEVBQXNDQyxXQUF0QyxFQUFtRDtBQUN6RSxRQUFNLEtBQUtDLFlBQUwsQ0FBa0Isb0JBQWxCLEVBQXdDLE1BQXhDLEVBQWdEO0FBQ3BERixJQUFBQSxPQURvRDtBQUVwREMsSUFBQUE7QUFGb0QsR0FBaEQsQ0FBTjtBQUlELENBTEQ7O0FBZUFILFFBQVEsQ0FBQ0ssWUFBVCxHQUF3QixlQUFlQSxZQUFmLENBQTZCRixXQUE3QixFQUEwQztBQUNoRSxTQUFPLE1BQU0sS0FBS0MsWUFBTCxDQUFrQixvQkFBbEIsRUFBd0MsTUFBeEMsRUFBZ0Q7QUFDM0RELElBQUFBO0FBRDJELEdBQWhELENBQWI7QUFHRCxDQUpEOztBQU9BRyxNQUFNLENBQUNDLE1BQVAsQ0FBY1IsVUFBZCxFQUEwQkMsUUFBMUI7ZUFFZUQsVSIsInNvdXJjZXNDb250ZW50IjpbImxldCBleHRlbnNpb25zID0ge30sIGNvbW1hbmRzID0ge307XG5cblxuLyoqXG4gKiBTZXRzIHRoZSBwcmltYXJ5IGNsaXBib2FyZCdzIGNvbnRlbnQgb24gdGhlIGRldmljZSB1bmRlciB0ZXN0LlxuICpcbiAqIEBwYXJhbSB7IXN0cmluZ30gY29udGVudCAtIFRoZSBjb250ZW50IHRvIGJlIHNldCBhcyBiYXNlNjQgZW5jb2RlZCBzdHJpbmcuXG4gKiBAcGFyYW0gez9zdHJpbmd9IGNvbnRlbnRUeXBlIFtwbGFpbnRleHRdIC0gVGhlIHR5cGUgb2YgdGhlIGNvbnRlbnQgdG8gc2V0LlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE9ubHkgYHBsYWludGV4dGAsICdpbWFnZSBhbmQgJ3VybCcgYXJlIHN1cHBvcnRlZC5cbiAqL1xuY29tbWFuZHMuc2V0Q2xpcGJvYXJkID0gYXN5bmMgZnVuY3Rpb24gc2V0Q2xpcGJvYXJkIChjb250ZW50LCBjb250ZW50VHlwZSkge1xuICBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL3dkYS9zZXRQYXN0ZWJvYXJkJywgJ1BPU1QnLCB7XG4gICAgY29udGVudCxcbiAgICBjb250ZW50VHlwZSxcbiAgfSk7XG59O1xuXG4vKipcbiAqIEdldHMgdGhlIGNvbnRlbnQgb2YgdGhlIHByaW1hcnkgY2xpcGJvYXJkIG9uIHRoZSBkZXZpY2UgdW5kZXIgdGVzdC5cbiAqXG4gKiBAcGFyYW0gez9zdHJpbmd9IGNvbnRlbnRUeXBlIFtwbGFpbnRleHRdIC0gVGhlIHR5cGUgb2YgdGhlIGNvbnRlbnQgdG8gZ2V0LlxuICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIE9ubHkgYHBsYWludGV4dGAsICdpbWFnZSBhbmQgJ3VybCcgYXJlIHN1cHBvcnRlZC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBhY3R1YWwgY2xpcGJvYXJkIGNvbnRlbnQgZW5jb2RlZCBpbnRvIGJhc2U2NCBzdHJpbmcuXG4gKiBBbiBlbXB0eSBzdHJpbmcgaXMgcmV0dXJuZWQgaWYgdGhlIGNsaXBib2FyZCBjb250YWlucyBubyBkYXRhLlxuICovXG5jb21tYW5kcy5nZXRDbGlwYm9hcmQgPSBhc3luYyBmdW5jdGlvbiBnZXRDbGlwYm9hcmQgKGNvbnRlbnRUeXBlKSB7XG4gIHJldHVybiBhd2FpdCB0aGlzLnByb3h5Q29tbWFuZCgnL3dkYS9nZXRQYXN0ZWJvYXJkJywgJ1BPU1QnLCB7XG4gICAgY29udGVudFR5cGUsXG4gIH0pO1xufTtcblxuXG5PYmplY3QuYXNzaWduKGV4dGVuc2lvbnMsIGNvbW1hbmRzKTtcbmV4cG9ydCB7IGNvbW1hbmRzIH07XG5leHBvcnQgZGVmYXVsdCBleHRlbnNpb25zO1xuIl0sImZpbGUiOiJsaWIvY29tbWFuZHMvY2xpcGJvYXJkLmpzIiwic291cmNlUm9vdCI6Ii4uLy4uLy4uIn0=
