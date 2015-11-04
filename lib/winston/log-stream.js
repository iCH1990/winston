'use strict';

var stream = require('stream'),
    util = require('util'),
    TransportStream = require('./transport-stream'),
    LegacyTransportStream = require('./legacy-transport-stream'),
    isStream = require('isstream'),
    common = require('./common');

var LogStream = module.exports = function LogStream (options) {
  var self = this;
  stream.Transform.call(this, { objectMode: true });

  //
  // TODO: What happens if someone overwrites the format
  // and then adds another TransportStream?
  //
  options = options || {};
  this.format = (options.format || require('./formats/default')());

  //
  // Hoist other options onto this instance.
  //
  this.setLevels(options.levels);
  this.level = options.level || 'info';
  this.exitOnError = typeof options.exitOnError !== 'undefined'
    ? options.exitOnError
    : true;

  if (options.transports) {
    options.transports.forEach(function (transport) {
      self.add(transport);
    });
  }

  if (options.padLevels || options.colors || options.stripColors
    || options.rewriters || options.formatters || options.emitErrs) {
    console.warn('{ padLevels, colors, stripColors, rewriters, formatters, emitErrs } were removed in winston@3.0.0.');
    console.warn('Use a custom winston.format(function) instead.');
    // TODO: Link to UPGRADE.md guide
  }

  //
  // Listen to readable events on the format and then
  // write those transformed `info` Objects onto
  // the buffer for this instance.
  //
  // The original `info` Objects are written to the format
  // in `LogStream.prototype._transform`
  //
  var self = this;
  this.format.on('readable', function () {
    var info;
    while (null !== (info = this.read())) {
      self.push(info);
    }
  });

  if (options.exceptionHandlers) {
    this.handleExceptions(options.exceptionHandlers);
  }
};

//
// Inherit from `stream.Transform`.
//
util.inherits(LogStream, stream.Transform);

/*
 * @private function setLevels
 * @param {Object} Target levels to use on this instance
 * Sets the `target` levels specified on this instance.
 */
LogStream.prototype.setLevels = function (target) {
  // TODO: Should we remove this?
  common.setLevels(this, this.levels, target);
  return this;
};

/*
 * @private function _transform (obj)
 * Pushes data so that it can be picked up by all of
 * our pipe targets.
 */
LogStream.prototype._transform = function (info, enc, callback) {
  //
  // Remark: really not sure what to do here, but this has been
  // reported as very confusing by pre winston@2.0.0 users as
  // quite confusing when using custom levels.
  //
  if (!this.levels[info.level] && this.levels[info.level] !== 0) {
    console.error('Unknown logger level: %s', info.level);
  }

  //
  // Here we write to the `format` pipe-chain, which
  // on `readable` above will push the formatted `info`
  // Object onto the buffer for this instance.
  //
  // TODO: How do we handle TransportStream instances with their
  // own format? We probably need two pipe chains here.
  //
  this.format.write(info);
  callback();
};

/*
 * function log (level, msg, meta)
 * function log (info)
 * Ensure backwards compatibility with a `log` method
 *
 * Supports the existing API, which is now DEPRECATED:
 *
 *    logger.log('info', 'Hello world', { custom: true });
 *
 * And the new API with a single JSON literal:
 *
 *    logger.log({ level: 'info', message: 'Hello world', custom: true });
 *
 * @api deprecated
 */
LogStream.prototype.log = function (level, msg, meta) {
  if (arguments.length === 1) {
    return this.write(level);
  }

  //
  // Alternative implementation
  //
  // this.write({
  //   level: level,
  //   message: msg,
  //   meta: meta
  // });

  meta = meta || {};
  meta.level = level;
  meta.message = msg;
  this.write(meta);
  return this;
};

/*
 * function add (transport)
 * Adds the transport to this logger instance by
 * piping to it.
 */
LogStream.prototype.add = function (transport) {
  var self = this;

  //
  // Support backwards compatibility with all existing
  // `winston@1.x.x` transport. All NEW transports should
  // inherit from `winston.TransportStream`.
  //
  // TODO: Support `format` in `TransportStream` backwards
  // compatibility.
  //
  var target = !isStream(transport)
    ? new LegacyTransportStream({ transport: transport })
    : transport

  if (!target._writableState || !target._writableState.objectMode) {
    throw new Error('Transports must WritableStreams in objectMode. Set { objectMode: true }.');
  }

  //
  // Listen for the `error` event on the new Transport
  //
  this._onError(target);
  this.pipe(transport);

  //
  // TODO: Re-implement handle exceptions options
  //
  return this;
};

/*
 * function remove (transport)
 * Removes the transport from this logger instance by
 * unpiping from it.
 */
LogStream.prototype.remove = function (transport) {
  this.unpipe(transport);
  return this;
};

/*
 * function clear (transport)
 * Removes all transports from this logger instance.
 */
LogStream.prototype.clear = function () {
  this.unpipe();
  return this;
};

/*
 * ### function close ()
 * Cleans up resources (streams, event listeners) for all
 * transports associated with this instance (if necessary).
 */
LogStream.prototype.close = function () {
  this.clear();
  this.emit('close');
  return this;
};

/*
 * Throw a more meaningful deprecation notice
 */
LogStream.prototype.cli = function () {
  throw new Error('Logger.cli() was removed in winston@3.0.0');
  console.warn('Use a custom winston.format(function) instead.');
  // TODO: Link to UPGRADE.md guide
};

//
// Some things stay the same
//
LogStream.prototype.query = function () {
  // More or less the same as winston@1.0.0
};

LogStream.prototype.stream = function () {
  // More or less the same as winston@1.0.0
};

//
// ### @private function _onError (transport)
// #### @transport {Object} Transport on which the error occured
// #### @err {Error} Error that occurred on the transport
// Bubbles the error, `err`, that occured on the specified `transport`
// up from this instance if `emitErrs` has been set.
//
LogStream.prototype._onError = function (transport) {
  var self = this;

  function transportError(err) {
    self.emit('error', err, transport);
  }

  if (!transport.__winstonError) {
    transport.__winstonError = transportError;
    transport.on('error', transport.__winstonError);
  }
};