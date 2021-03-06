(function() {
  var Feedly, _normalizeTag, fs, http, open, path, q, request, untildify, url, utils;

  fs = require('fs');

  http = require('http');

  path = require('path');

  url = require('url');

  open = require('open');

  q = require('q');

  request = require('request');

  untildify = require('untildify');

  utils = require('./utils');

  _normalizeTag = function(str, userid) {
    if (!str.match(/^user\//)) {
      str = "user/" + userid + "/tag/" + str;
    }
    return encodeURIComponent(str);
  };

  module.exports = Feedly = (function() {
    function Feedly(options) {
      this.options = utils.extend({
        port: 0,
        base: 'http://cloud.feedly.com',
        config_file: '~/.feedly',
        html_file: path.join(__dirname, '../html/index.html'),
        html_text: 'No HTML found',
        slop: 3600000,
        client_id: null,
        client_secret: null
      }, options);
      this.options.config_file = untildify(this.options.config_file);
      this.options.html_file = untildify(this.options.html_file);
      if ((this.options.client_id == null) || (this.options.client_secret == null)) {
        throw new Error("client_id and client_secret required");
      }
      this.state = {};
      this.ready = q.allSettled([this._loadConfig(), this._loadHTML()]);
    }

    Feedly.prototype._loadConfig = function() {
      if (this.options.config_file == null) {
        return null;
      }
      return q.nfcall(fs.readFile, this.options.config_file).then((function(_this) {
        return function(data) {
          var er, s;
          return _this.state = (function() {
            try {
              s = JSON.parse(data);
              if (s.expires != null) {
                s.expires = new Date(s.expires);
              }
              return s;
            } catch (_error) {
              er = _error;
              return this.state = {};
            }
          }).call(_this);
        };
      })(this), function(er) {
        return this.state = {};
      });
    };

    Feedly.prototype._loadHTML = function() {
      if (this.options.html_file == null) {
        return null;
      }
      return q.nfcall(fs.readFile, this.options.html_file).then((function(_this) {
        return function(data) {
          _this.options.html_text = data.toString('utf8');
          return true;
        };
      })(this));
    };

    Feedly.prototype._save = function() {
      if (this.options.config_file != null) {
        return q.nfcall(fs.writeFile, this.options.config_file, JSON.stringify(this.state));
      } else {
        return q.resolve();
      }
    };

    Feedly.prototype._validToken = function() {
      return (this.state.access_token != null) && (this.state.refresh_token != null) && (this.state.expires != null) && (this.state.expires > new Date());
    };

    Feedly.prototype._getAuth = function() {
      return this.ready.then((function(_this) {
        return function() {
          switch (false) {
            case !!_this._validToken():
              return _this._auth();
            case !((_this.state.expires - new Date()) < _this.options.slop):
              return _this._refresh();
            default:
              return q.resolve(_this.state.access_token);
          }
        };
      })(this));
    };

    Feedly.prototype._auth = function() {
      var addr, ref, result, u;
      ref = utils.qserver(this.options.port, this.options.html_text), addr = ref[0], result = ref[1];
      u = url.parse(this.options.base);
      return addr.then((function(_this) {
        return function(cb_url) {
          u.pathname = '/v3/auth/auth';
          u.query = {
            response_type: 'code',
            client_id: _this.options.client_id,
            redirect_uri: cb_url,
            scope: 'https://cloud.feedly.com/subscriptions'
          };
          open(url.format(u));
          return result.spread(function(results, body) {
            if (results.error != null) {
              return q.reject(results.error);
            }
            return _this._getToken(results.code, cb_url);
          });
        };
      })(this));
    };

    Feedly.prototype._getToken = function(code, redirect) {
      var u;
      u = url.parse(this.options.base);
      u.pathname = '/v3/auth/token';
      return utils.qrequest({
        method: 'POST',
        uri: url.format(u),
        body: {
          code: code,
          client_id: this.options.client_id,
          client_secret: this.options.client_secret,
          grant_type: 'authorization_code',
          redirect_uri: redirect
        }
      }).then((function(_this) {
        return function(body) {
          _this.state = utils.extend(_this.state, body);
          _this.state.expires = new Date(new Date().getTime() + (body.expires_in * 1000));
          _this._save();
          return _this.state.access_token;
        };
      })(this));
    };

    Feedly.prototype._refresh = function() {
      var u;
      u = url.parse(this.options.base);
      u.pathname = '/v3/auth/token';
      u.query = {
        refresh_token: this.state.refresh_token,
        client_id: this.options.client_id,
        client_secret: this.options.client_secret,
        grant_type: 'refresh_token'
      };
      return utils.qrequest({
        method: 'POST',
        uri: url.format(u)
      }).then((function(_this) {
        return function(body) {
          _this.state = utils.extend(_this.state, body);
          _this.state.expires = new Date(new Date().getTime() + (body.expires_in * 1000));
          _this._save();
          return _this.state.access_token;
        };
      })(this));
    };

    Feedly.prototype._request = function(callback, path, method, body) {
      var u;
      if (method == null) {
        method = 'GET';
      }
      if (body == null) {
        body = null;
      }
      u = url.parse(this.options.base);
      u.pathname = path;
      return this._getAuth().then(function(auth) {
        return utils.qrequest({
          method: method,
          uri: url.format(u),
          headers: {
            Authorization: "OAuth " + auth
          },
          body: body,
          callback: callback
        });
      });
    };

    Feedly.prototype._requestURL = function(callback, path, method, body) {
      var u;
      if (method == null) {
        method = 'GET';
      }
      if (body == null) {
        body = null;
      }
      u = url.parse(this.options.base);
      u.pathname = path;
      u.query = body;
      return this._getAuth().then(function(auth) {
        return utils.qrequest({
          method: method,
          uri: url.format(u),
          headers: {
            Authorization: "OAuth " + auth
          },
          callback: callback
        });
      });
    };

    Feedly.prototype._normalizeTags = function(ary) {
      var userid;
      userid = this.state.id;
      return ary.map(function(s) {
        return _normalizeTag(s, userid);
      });
    };

    Feedly.prototype._normalizeCategories = function(ary) {
      var userid;
      userid = this.state.id;
      return ary.map(function(cat) {
        if (!cat.match(/^user\//)) {
          cat = "user/" + userid + "/category/" + cat;
        }
        return cat;
      });
    };

    Feedly.prototype.refresh = function(cb) {
      return this.ready.then((function(_this) {
        return function() {
          var p;
          p = _this._validToken() ? _this._refresh() : _this._auth();
          return p.nodeify(cb);
        };
      })(this));
    };

    Feedly.prototype.logout = function(cb) {
      return this.ready.then((function(_this) {
        return function() {
          var u;
          u = url.parse(_this.options.base);
          u.pathname = '/v3/auth/token';
          u.query = {
            refresh_token: _this.state.refresh_token,
            client_id: _this.options.client_id,
            client_secret: _this.options.client_secret,
            grant_type: 'revoke_token'
          };
          return utils.qrequest({
            method: 'POST',
            uri: url.format(u)
          }).then(function(body) {
            delete _this.state.access_token;
            delete _this.state.expires;
            delete _this.state.plan;
            delete _this.state.provider;
            delete _this.state.refresh_token;
            delete _this.state.token_type;
            _this.state = utils.extend(_this.state, body);
            return _this._save();
          }).nodeify(cb);
        };
      })(this));
    };

    Feedly.prototype.categories = function(cb) {
      return this._request(cb, '/v3/categories');
    };

    Feedly.prototype.setCategoryLabel = function(id, label, cb) {
      return this._request(cb, "/v3/categories/" + (encodeURIComponent(id)), 'POST', {
        label: label
      });
    };

    Feedly.prototype.deleteCategory = function(id, cb) {
      return this._request(cb, "/v3/categories/" + (encodeURIComponent(id)), 'DELETE');
    };

    Feedly.prototype.entry = function(id, cb) {
      if (Array.isArray(id)) {
        return this._request(cb, "/v3/entries/.mget", 'POST', id);
      } else {
        return this._request(cb, "/v3/entries/" + (encodeURIComponent(id)));
      }
    };

    Feedly.prototype.createEntry = function(entry, cb) {
      return this._request(cb, '/v3/entries/', 'POST', entry);
    };

    Feedly.prototype.feed = function(id, cb) {
      if (Array.isArray(id)) {
        return this._request(cb, '/v3/feeds/.mget', 'POST', id);
      } else {
        return this._request(cb, "/v3/feeds/" + (encodeURIComponent(id)));
      }
    };

    Feedly.prototype.counts = function(autorefresh, newerThan, streamId, cb) {
      var found, input, ref, ref1, ref2;
      if (typeof autorefresh === 'function') {
        ref = [autorefresh, null, null, null], cb = ref[0], autorefresh = ref[1], newerThan = ref[2], streamId = ref[3];
      } else if (typeof newerThan === 'function') {
        ref1 = [newerThan, null, null], cb = ref1[0], newerThan = ref1[1], streamId = ref1[2];
      } else if (typeof streamId === 'function') {
        ref2 = [streamId, null], cb = ref2[0], streamId = ref2[1];
      }
      input = {};
      found = false;
      if (autorefresh != null) {
        input.autorefresh = autorefresh;
        found = true;
      }
      if (newerThan != null) {
        input.newerThan = newerThan.getTime();
        found = true;
      }
      if (streamId != null) {
        input.streamId = streamId;
        found = true;
      }
      if (!found) {
        input = null;
      }
      return this._request(cb, '/v3/markers/counts', 'GET', input);
    };

    Feedly.prototype.markEntryRead = function(ids, cb) {
      if (typeof ids === 'string') {
        ids = [ids];
      }
      return this._request(cb, '/v3/markers', 'POST', {
        entryIds: ids,
        type: 'entries',
        action: 'markAsRead'
      });
    };

    Feedly.prototype.markEntryUnread = function(ids, cb) {
      if (typeof ids === 'string') {
        ids = [ids];
      }
      return this._request(cb, '/v3/markers', 'POST', {
        entryIds: ids,
        type: 'entries',
        action: 'keepUnread'
      });
    };

    Feedly.prototype.markFeedRead = function(ids, since, cb) {
      var body, ref;
      if (typeof ids === 'string') {
        ids = [ids];
      }
      if (typeof since === 'function') {
        ref = [since, null], cb = ref[0], since = ref[1];
      }
      body = {
        feedIds: ids,
        type: 'feeds',
        action: 'markAsRead'
      };
      if (typeof since === 'Date') {
        body.asOf = since.getTime();
      } else if (typeof since === 'Date') {
        body.lastReadEntryId = since;
      }
      return this._request(cb, '/v3/markers', 'POST', body);
    };

    Feedly.prototype.markCategoryRead = function(ids, since, cb) {
      var ref;
      if (typeof ids === 'string') {
        ids = [ids];
      }
      if (typeof since === 'function') {
        ref = [since, null], cb = ref[0], since = ref[1];
      }
      return this.ready.then((function(_this) {
        return function() {
          var body;
          body = {
            categoryIds: _this._normalizeCategories(ids),
            type: 'categories',
            action: 'markAsRead'
          };
          if (typeof since === 'Date') {
            body.asOf = since.getTime();
          } else if (typeof since === 'Date') {
            body.lastReadEntryId = since;
          }
          return _this._request(cb, '/v3/markers', 'POST', body);
        };
      })(this));
    };

    Feedly.prototype.reads = function(newerThan, cb) {
      var input, ref;
      if (typeof newerThan === 'function') {
        ref = [newerThan, null], cb = ref[0], newerThan = ref[1];
      }
      input = null;
      if (newerThan != null) {
        input = {
          newerThan: newerThan.getTime()
        };
      }
      return this._request(cb, '/v3/markers/reads', 'GET', input);
    };

    Feedly.prototype.tags = function(newerThan, cb) {
      var input, ref;
      if (typeof newerThan === 'function') {
        ref = [newerThan, null], cb = ref[0], newerThan = ref[1];
      }
      input = null;
      if (newerThan != null) {
        input = {
          newerThan: newerThan.getTime()
        };
      }
      return this._request(cb, '/v3/markers/tags', 'GET', input);
    };

    Feedly.prototype.preferences = function(cb) {
      return this._request(cb, '/v3/preferences');
    };

    Feedly.prototype.updatePreferences = function(prefs, cb) {
      if ((prefs == null) || (typeof prefs === 'function')) {
        throw new Error("prefs required");
      }
      return this._request(cb, '/v3/preferences', 'POST', prefs);
    };

    Feedly.prototype.profile = function(cb) {
      return this._request(cb, '/v3/profile');
    };

    Feedly.prototype.updateProfile = function(profile, cb) {
      if ((profile == null) || (typeof profile === 'function')) {
        throw new Error("profile required");
      }
      return this._request(cb, '/v3/profile', 'POST', profile);
    };

    Feedly.prototype.searchFeeds = function(query, results, cb) {
      if (results == null) {
        results = 20;
      }
      if ((query == null) || (typeof query === 'function')) {
        throw new Error("query required");
      }
      return this._requestURL(cb, '/v3/search/feeds', 'GET', {
        query: query,
        n: results
      });
    };

    Feedly.prototype.shorten = function(entry, cb) {
      if ((entry == null) || (typeof entry === 'function')) {
        throw new Error("entry required");
      }
      return this._requestURL(cb, '/v3/shorten/entries', 'GET', {
        entryId: entry
      });
    };

    Feedly.prototype.stream = function(id, options, cb) {
      var input;
      input = (function() {
        switch (typeof options) {
          case 'function':
            cb = options;
            return {};
          case 'string':
            return {
              continuation: options
            };
          case 'object':
            return options;
          default:
            return {};
        }
      })();
      return this._requestURL(cb, "/v3/streams/" + (encodeURIComponent(id)) + "/ids", 'GET', input);
    };

    Feedly.prototype.contents = function(id, continuation, cb) {
      var input;
      input = {};
      if (continuation != null) {
        input.continuation = continuation;
      }
      return this._request(cb, "/v3/streams/" + (encodeURIComponent(id)) + "/contents", 'GET', input);
    };

    Feedly.prototype.subscriptions = function(cb) {
      return this._request(cb, '/v3/subscriptions');
    };

    Feedly.prototype.subscribe = function(url, categories, cb) {
      var input, ref;
      if (!url.match(/^feed\//)) {
        url = "feed/" + url;
      }
      if (typeof categories === 'function') {
        ref = [categories, null], cb = ref[0], categories = ref[1];
      }
      input = {
        id: url
      };
      return this.ready.then((function(_this) {
        return function() {
          var userid;
          if (categories != null) {
            if (!Array.isArray(categories)) {
              categories = [categories];
            }
            userid = _this.state.id;
            categories = categories.map(function(c) {
              var id, m, name;
              if (typeof c === 'string') {
                m = c.match(/^user\/[^\/]+\/(.*)/);
                name = null;
                id = null;
                if (!m) {
                  name = c;
                  id = "user/" + userid + "/category/" + c;
                } else {
                  name = m[1];
                  id = c;
                }
                c = {
                  id: id,
                  name: name
                };
              }
              return c;
            });
            input.categories = categories;
          }
          return _this._request(cb, '/v3/subscriptions', 'POST', input);
        };
      })(this));
    };

    Feedly.prototype.unsubscribe = function(id, cb) {
      return this._request(cb, "/v3/subscriptions/" + (encodeURIComponent(id)), 'DELETE');
    };

    Feedly.prototype.tagEntry = function(entry, tags, cb) {
      return this.ready.then((function(_this) {
        return function() {
          var userid;
          userid = _this.state.id;
          if (typeof tags === 'string') {
            tags = [tags];
          }
          tags = _this._normalizeTags(tags);
          if (Array.isArray(entry)) {
            return _this._request(cb, "/v3/tags/" + (tags.join(',')), 'PUT', {
              entryIds: entry
            });
          } else {
            return _this._request(cb, "/v3/tags/" + (tags.join(',')), 'PUT', {
              entryId: entry
            });
          }
        };
      })(this));
    };

    Feedly.prototype.setTagLabel = function(tag, label, cb) {
      return this.ready.then((function(_this) {
        return function() {
          tag = _normalizeTag(tag, _this.state.id);
          return _this._request(cb, "/v3/tags/" + tag, 'POST', {
            label: label
          });
        };
      })(this));
    };

    Feedly.prototype.untagEntries = function(entries, tags, cb) {
      return this.ready.then((function(_this) {
        return function() {
          if (!Array.isArray(entries)) {
            entries = [entries];
          }
          entries = entries.map(function(e) {
            return encodeURIComponent(e);
          });
          if (!Array.isArray(tags)) {
            tags = [tags];
          }
          tags = _this._normalizeTags(tags);
          return _this._request(cb, "/v3/tags/" + (tags.join(',')) + "/" + (entries.join(',')), 'DELETE');
        };
      })(this));
    };

    Feedly.prototype.deleteTags = function(tags, cb) {
      return this.ready.then((function(_this) {
        return function() {
          if (!Array.isArray(tags)) {
            tags = [tags];
          }
          tags = _this._normalizeTags(tags);
          return _this._request(cb, "/v3/tags/" + (tags.join(',')), 'DELETE');
        };
      })(this));
    };

    return Feedly;

  })();

}).call(this);
