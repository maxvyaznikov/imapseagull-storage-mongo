var bcrypt = require('bcrypt-nodejs');
var mongojs = require('mongojs');
var uuid = require('node-uuid');
var path = require('path');
var fs = require('fs');
var tmp = require('tmp');
var extend = require('xtend');
var async = require('async');
var sanitizer = require('sanitizer');
var MailComposer = require('mailcomposer').MailComposer;
var MailParser = require('mailparser').MailParser;


/**
 * @param mail (object) results of MongoDecorator.prototype.parse_raw_msg
 * @param callback
 */
function make_html_safe(mail, callback) {
    mail.html = sanitizer.sanitize(mail.html || '');
    callback();
}


/**
 * @param cfg may have:
 *      @param cfg.debug (bool) flag for extra messages
 *      @param cfg.attachments_path (string) path to directory to keep attachments, for example:
 *          path.join(__dirname, './attachments')
 *      @param cfg.server_name (string) for conversion: username <-> email
 *      @param cfg.post_parse_handlers (array) functions to post processing mail message after parse
 * @returns {MongoDecorator}
 * @constructor
 */
function MongoDecorator(cfg) {
    this._cfg = cfg;
    this.debug = cfg.debug;
    this.attachments_path = cfg.attachments_path;
    this.server_name = cfg.name;

    this.post_parse_handlers = (cfg.post_parse_handlers || []);
    this.post_parse_handlers.push(make_html_safe);

    return this
}

MongoDecorator.prototype.init = function(callback) {
    this._db = mongojs(this._cfg.connection, [this._cfg.messages, this._cfg.users]);

    this._messages = this._db[this._cfg.messages];
    this._users = this._db[this._cfg.users];

    callback(null, this);
    return this
};

/**
 * Short usage:
 * parse_raw_msg(function(mail) { ... }).end(raw);
 *
 * @param callback (Function) will be called when message is parsed
 * @return MailParser object to stream data
 *
 * Parsed mail object (like return by https://github.com/andris9/mailparser):
 *     headers - unprocessed headers in the form of - {key: value} - if there were multiple fields with the same key then the value is an array
 *     from - an array of parsed From addresses - [{address:'sender@example.com',name:'Sender Name'}] (should be only one though)
 *     to - an array of parsed To addresses
 *     cc - an array of parsed Cc addresses
 *     bcc - an array of parsed 'Bcc' addresses
 *     subject - the subject line
 *     references - an array of reference message id values (not set if no reference values present)
 *     inReplyTo - an array of In-Reply-To message id values (not set if no in-reply-to values present)
 *     priority - priority of the e-mail, always one of the following: normal (default), high, low
 *     text - text body
 *     html - html body
 *     date - date field as a Date() object. If date could not be resolved or is not found this field is not set. Check the original date string from headers.date
 *     attachments - an array of attachments,
 *          attachment object contains:
 *                   filePath: '/tmp/1234',
 *                   cid: '123123123123@localhost',
 *                   fileName: 'image.png',
 *                   length: 126,
 *                   contentType: 'image/png'
 */
MongoDecorator.prototype.parse_raw_msg = function(callback) {
    var mailparser = new MailParser({
        defaultCharset: 'UTF-8',
        streamAttachments: true,
        forceEmbeddedImages: true
    });
    mailparser.attached_files = [];
    mailparser.on('attachment', (function(attachment) {
        tmp.tmpName(function(err, path) {
            if (err) throw err;

            attachment.filePath = path;
            attachment.stream.pipe(fs.createWriteStream(path));
            mailparser.attached_files.push(attachment);
        }.bind(this));
    }.bind(this)));
    mailparser.on('end', function(mail) {
        async.map(mailparser.attached_files, function(attachment, next) {
            var new_path = attachment.checksum +'-'+ process.hrtime()[0];
            fs.rename(attachment.filePath, path.join(this.attachments_path, new_path), function(err) {
                next(err, {
                    path: new_path,
                    name: attachment.generatedFileName,
                    ext: attachment.generatedFileName.split(".").pop().toLowerCase(),
                    cid: attachment.contentId,
                    length: attachment.length,
                    contentType: attachment.contentType
                })
            })
        }.bind(this), function(err, attached_files) {
            mail.attached_files = attached_files;

            async.applyEach(this.post_parse_handlers, mail, function() {
                callback(mail);
            }.bind(this));
        }.bind(this));
    }.bind(this));
    return mailparser;
};

/**
 * Build raw message (one big string with headers and body) from object in DB
 */
var fields_to_exclude = ['content-type', 'content-transfer-encoding', 'subject', 'from', 'to'];
MongoDecorator.prototype.build_raw_msg = function(message, callback) {
    if (message.raw) {
        return callback(null, message.raw);
    }
    var mailcomposer = new MailComposer();
    // TODO: useDKIM
    mailcomposer.setMessageOption({
        subject: message.subject,
        from: message.headers && message.headers['from'] || message.from && message.from.address || message.from, // message.from,
        to: message.headers && message.headers['to'] || message.to && message.to.address || message.to, // message.to,
        text: message.text,
        html: message.html
    });
    for (var name in message.headers) {
        if (message.headers.hasOwnProperty(name) && fields_to_exclude.indexOf(name) < 0) {
            mailcomposer.addHeader(name, message.headers[name]);
        }
    }
    if (message.attached_files) {
        message.attached_files.forEach(function(attachment) {
            mailcomposer.addAttachment(attachment);
        });
    }
    return mailcomposer.buildMessage(function(err, raw) {
        message.raw = raw; //cache result
        callback(err, raw);
    });
};

/**
 *
 * @param {Object} user should contain at least an _id
 * @param {Object|string} [folder]
 * @param {Array} [flags] leave null if don't want to use
 * @param {int} [limit] leave null if don't want to use
 * @param {func} [callback]
 */
MongoDecorator.prototype.msgs_find = function(user, folder, flags, limit, callback) {
    var query = {};
    if (user) {
        query.user = user._id;
    }
    if (folder) {
        query.folder = folder['special-use'] || folder;
    }
    if (flags) {
        query.flags = flags;
    }
    if (limit) {
        this._messages.find(query).sort({uid: 1}).limit(limit, callback);
    } else {
        this._messages.find(query).sort({uid: 1}, callback);
    }
};

/**
 * Insert message into DB. You can simple rewrite this function.
 * But remember required fields in Message object:
 *  * (String) [uid]
 *  * (ObjectId) [user]
 *  * (String) [folder]
 *  * (Array of Strings) [flags]
 *  * [date]
 *  * [internaldate]
 *  * (Array of Objects) [attached_files]
 *  * [MODSEQ] for condstore plugin
 *
 * TODO: increase uidnext into folder of IMAPServer somehow
 *
 * @param message should have structure described in comments to MongoDecorator.prototype.parse_raw_msg
 * @param callback
 */
MongoDecorator.prototype.msg_insert = function(message, callback) {
    if (message && message._id) {
        delete message._id;
    }
    this._messages.insert(message, callback);
};

MongoDecorator.prototype.msg_update = function(message, callback) {
    if (this.debug && !message._id) {
        console.trace("Variable 'message._id' is not set");
    }
    this._messages.update({
        _id: message._id
    }, message, callback);
};


MongoDecorator.prototype.msgs_count = function(user, folder, callback) {
    var query = {};
    if (user) {
        query.user = user._id;
    }
    if (folder) {
        query.folder = folder['special-use'] || folder;
    }
    this._messages.count(query, callback);
};

/**
 *
 * @param {Object} user should contain at least an _id
 * @param folder
 * @param flags
 * @param {function} [callback] will be called with arguments: {String} err, {Array} deleted_messages, {Number} count
 */
MongoDecorator.prototype.msgs_remove = function(user, folder, flags, callback) {
    var query = {};
    if (user) {
        query.user = user._id;
    }
    if (folder) {
        query.folder = folder['special-use'] || folder;
    }
    if (flags) {
        query.flags = flags;
    }
    this._messages.find(query, function(err, deleted_messages) {
        if (err) {callback(err); return}

        this._messages.remove(query, function(err, opt) {
            callback(err, deleted_messages, opt && opt.n || 0);
        });
    }.bind(this));
};


/**
 *
 * @param {String/Array} username - string username of array of usernames
 * @param {function} [callback] will be called with arguments: {String} err, {Array} deleted_messages, {Number} count
 */
MongoDecorator.prototype.user_get = function(username, callback) {
    var query = { $or: [
        { email: username.indexOf('@') >= 0 ? username : username + '@' + this.server_name },
        { 'aliases.email': username }
    ] };
    this._users.find(query).limit(1, function(err, users) {
        callback(err, users && users.length && users[0] || null)
    });
};

/**
 *
 * @param user {Object} is a result of `user_get` function
 * @param remote_password {String}
 * @param callback {Function}
 * @returns boolean
 */
MongoDecorator.prototype.user_has_password = function(user, remote_password, callback) {
    if (!remote_password || !user) {
        callback(null, false);
    } else {
        bcrypt.compare(remote_password, user.password, callback);
    }
//    callback(null, remote_password && user && user.password === remote_password)
};

module.exports = MongoDecorator;
