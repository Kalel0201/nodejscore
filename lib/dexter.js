'use strict';

var iocContainer = require('nodejs-ioc-container'),
    swig = require('swig'),
    mongoose = require('mongoose'),
    passport = require('passport'),
    _container = iocContainer.container(),
    fs = require('fs'),
    EventEmitter = require('events').EventEmitter,
    _ = require('lodash'),
    path = require('path'),
    config = require('./config'),
    util = require('./util');

var Dexter,
    _events = new EventEmitter(),
    _modules = [],
    _allMenus = [],
    _middleware = {
        before: {},
        after: {}
    };
var _aggregated = {
    js: '',
    css:''
};
var _appMenus;

function NodeCore() {
    if (this.active) {
        return;
    }

    this.events = _events;
    this.version = require('../package').version;
}

NodeCore.prototype.serve = function (options, callback) {
    if (this.active) {
        return this;
    }

    Dexter = this;

    var defaultConfig = util.loadConfig(),
        db = mongoose.connect(defaultConfig.db || ''),
        app;

    this.register('database', {
        connection: db
    });

    this.config = new Config(function (err, config) {
        app = require('./bootstrap')(passport, db);

        app.listen(config.port);
        console.log('Dexter\'s NodeJs Framework started at port: ' + defaultConfig.port + ' (' + process.env.NODE_ENV + ')');

        findModules(function () {
            enableModules(function (_modules) {

            });
        });

        Dexter.name = config.app.name;
        Dexter.app = app;

        _appMenus = new Dexter.Menus();
        Dexter.menus = _appMenus;
    });



    if (!callback || typeof callback !== 'function') {
        callback = function () {};
    }

    callback(app, defaultConfig);

    Dexter.active = true;
    Dexter.options = options;
};

function Config(callback) {
    if (this.config) {
        return this.config;
    }

    if (!callback || typeof callback !== 'function') {
        callback = function () {};
    }

    function loadSettings(Config, callback) {
        var Package = loadPackageModel(),
            defaultConfig = util.loadConfig();

        if (!Package) {
            return defaultConfig;
        }

        Package.findOne({
            name: 'config'
        }, function (err, doc) {
            var original = JSON.flatten(defaultConfig, {
                default: true
            });

            var saved = JSON.flatten(doc ? doc.settings : defaultConfig, {});
            var merged = mergeConfig(original, saved);
            var clean = JSON.unflatten(merged.clean, {});
            var diff = JSON.unflatten(merged.diff, {});

            Config.verbose = {
                clean: clean,
                diff: diff,
                flat: merged
            };

            Config.clean = clean;
            Config.diff = diff;
            Config.flat = merged;

            callback(err, clean);
        });

        function mergeConfig(original, saved) {
            var clean = {};

            for (var index in saved) {
                clean[index] = saved[index].value;

                if (original[index]) {
                    original[index].value = saved[index].value;
                } else {
                    original[index] = {
                        value: saved[index].value,
                    };
                }

                original[index]['default'] = original[index]['default'] || saved[index]['default'];
            }

            return {
                diff: original,
                clean: clean
            };
        }
    }

    function loadPackageModel() {
        var database = _container.get('database');

        if (!database || !database.conenction) {
            return null;
        }

        if (!database.connection.models.Package) {
            require('../modules/package')(database);
        }

        return database.connection.model('Package');
    }


}

NodeCore.prototype.loadConfig = util.loadConfig;

NodeCore.prototype.status = function () {
    return {
        active: this.active,
        name: this.name
    };
};

NodeCore.prototype.register = _container.register;
NodeCore.prototype.resolve = _container.resolve;
NodeCore.prototype.load = _container.get;

NodeCore.prototype.moduleEnabled = function (name) {
    return _modules[name] ? true : false;
};

NodeCore.prototype.modules = (function () {
    return _modules;
})();

NodeCore.prototype.aggregated = _aggregated;

NodeCore.prototype.Menus = function (name) {
    var _option = {
        roles: [
            'annonymous'
        ],
        title: '',
        menu: 'main',
        link: '',
        icon: ''
    };

    this.add = function (options) {
        var _menu;

        options = _.extend(_option, options);
        _menu = {
            roles: options.roles,
            title: options.title,
            link: options.link,
            icon: options.icon
        };

        if (_allMenus[options.menu]) {
            _allMenus[options.menu].push(_menu);
        } else {
            _allMenus[options.menu] = [_menu];
        }
    };

    this.get = function (options) {
        var _allowed = [];

        options = _.extend(_option, options);

        if (_allMenus[options.menu] || options.defaultMenu) {
            var items = options.defaultMenu.concat(_allMenus[options.menu]);

            items.forEach(function (menu) {
                if (menu !== undefined) {
                    var _hasRole = false;

                    options.roles.forEach(function (role) {
                        if (role === 'admin' || menu.roles.indexOf('annonymous') > -1 || menu.roles.indexOf(role) > -1) {
                            _hasRole = true;
                        }
                    });

                    if (_hasRole) {
                        _allowed.push(menu);
                    }
                }
            });
        }

        return _allowed;
    };
};

NodeCore.prototype.Module = function (name) {
    this.name = name.toLowerCase();
    this.menus = _appMenus;

    // Bootstrap models
    util.walk(getModulePath(this.name, 'server'), 'models', null, function (model) {
        require(model);
    });

    this.render = function (view, options, callback) {
        swig.renderFile(getModulePath(this.name, '/server/views/' + view + '.html'), options, callback);
    };

    // Bootstrap routers
    this.routes = function () {
        var args = Array.prototype.slice.call(arguments);
        var that = this;

        util.walk(getModulePath(this.name, 'server'), 'routes', 'middlewares', function (route) {
            require(route).apply(that, [that].concat(args));
        });
    };

    this.aggregateAsset = function (type, asset, options) {
        aggregate(
            type,
            options && options.absolute ? asset : path.join(_modules[this.name].source, this.name, 'public/assets/', type, asset),
            options
        );
    };

    this.angularDependencies = function (dependencies) {
        this.anguarDependencies = dependencies;
        _modules[this.name].dependencies = dependencies;
    };

    this.register = function (callback) {
        _container.register(name, callback);
    };

    this.settings = function () {
        if (!arguments.length) {
            return;
        }

        var dexter = require('nodejscore');
        var database = dexter.get('database');

        if (!database || database.connection) {
            return {
                err: true,
                message: 'No database connection'
            };
        }

        var Package = database.connection.model('Package');

        if (arguments.length === 2) {
            return updateSettings(this.name, arguments[0], arguments[1]);
        }

        if (arguments.length === 1 && typeof arguments[0] === 'object') {
            return updateSettings(this.name, arguments[0], function () {});
        }

        if (arguments.length === 1 && typeof arguments[0] === 'function') {
            return getSettings(this.name, arguments[0]);
        }

        function updateSettings(name, settings, callback) {
            Package.findOneAndUpdate({
                name: name
            }, {
                $set: {
                    settings: settings,
                    updated: new Date()
                }
            }, {
                upsert: true,
                multi: false
            }, function (err, doc) {
                if (err) {
                    console.log(err);
                    return callback(true, 'Failed to update settings');
                }

                return callback(null, doc);
            });
        }

        function getSettings(name, callback) {
            Package.findOne({
                name: name
            }, function (err, doc) {
                if (err) {
                    return callback(true, 'Failed to retrieve settings');
                }

                return callback(null, doc);
            });
        }
    };
};

NodeCore.prototype.chainware = {
    add: function (event, weight, func) {
        _middleware[event].splice(weight, 0, {
            weight: weight,
            func: func
        });
        _middleware[event].join();
        _middleware[event].sort(function (a, b) {
            if (a.weight < b.weight) {
                a.next = b.func;
            } else {
                b.next = a.func;
            }

            return (a.weight - b.weight);
        });
    },

    before: function (req, res, next) {
        if (!_middleware.before.length) {
            return next();
        }

        this.chain('before', 0, req, res, next);
    },

    after: function (req, res, next) {
        if (!_middleware.after.length) {
            return next();
        }

        this.chain('after', 0, req, res, next);
    },

    chain: function (operator, index, req, res, next) {
        var args = [
            req,
            res,
            function () {
                if (_middleware[operator][index + 1]) {
                    this.chain('before', index + 1, req, res, next);
                } else {
                    next();
                }
            }
        ];

        _middleware[operator][index].func.apply(this, args);
    }
};

function getModulePath(name, plus) {
    return path.join(process.cwd(), _modules[name].source, name, plus);
}

function findModules(callback) {
    var searchSource = function (source, callback) {
        fs.stat(path.join(process.cwd(), source), function (err, stats) {
            if (err) {
                console.log(err);
                return callback();
            }

            if (stats.isDirectory()) {
                fs.readdir(path.join(process.cwd(), source), function (err, files) {
                    if (err) {
                        console.log(err);
                        return callback();
                    }

                    if (!files) {
                        files = [];
                    }

                    if (!files.length) {
                        return callback();
                    }

                    files.forEach(function (file, index) {
                        if (file === '.bin' || file === '.DS_Store') {
                            if (files.length - 1 === index) {
                                return callback();
                            }

                            return;
                        }

                        fs.readFile(path.join(process.cwd(), source, file, 'package.json'), function (err, data) {
                            if (err) {
                                console.log('err');
                                throw err;
                            }

                            if (data) {
                                try {
                                    var json = JSON.parse(data.toString());

                                    if (json.dexter) {
                                        _modules[json.name] = {
                                            version: json.version,
                                            source: source
                                        };
                                    }
                                } catch (err) {
                                    return callback();
                                }
                            }

                            if (files.length - 1 === index) {
                                return callback();
                            }
                        });
                    });
                });
            }
        });
    };

    var sources = config.sources || [];
    var nSource = sources.length;
    var searchDone = function () {
        nSource--;

        if (!nSource) {
            _events.emit('modulesFound');

            if (!callback || typeof callback !== 'function') {
                callback = function () {};
            }

            callback();
        }
    };
    sources.forEach(function (source) {
        searchSource(source, searchDone);
    });
}

function enableModules(callback) {
    var name, remaining = 0;

    for (name in _modules) {
        remaining++;
        require(path.join(process.cwd(), _modules[name].source, name, 'app.js'));
    }

    for (name in _modules) {
        name = capitaliseFirstLetter(name);
        _container.resolve.apply(_container, [name]);
        _container.get(name);
        remaining--;

        if (!remaining) {
            _events.emit('modulesEnabled');

            if (!callback || typeof callback !== 'function') {
                callback = function () {};
            }

            callback(_modules);
        }
    }
}

function aggregate(ext, aggPath, options) {
    var libs = true,
        name;

    options = options || {};

    if (aggPath) {
        return readFiles(ext, path.join(process.cwd(), aggPath));
    }

    libs = false;
    _events.on('modulesFound', function () {
        for (name in _modules) {
            readFiles(ext, path.join(process.cwd(), _modules[name].source, name, 'public'));
        }
    });

    function readFiles(ext, filePath) {
        fs.stat(filePath, function (err, stats) {
            if (err) {
                return err;
            }

            if (stats.isDirectory()) {
                fs.readdir(filePath, function (err, files) {
                    if (err) {
                        throw err;
                    }

                    if (!files) {
                        files = [];
                    }

                    files.forEach(function (file) {
                        if (!libs && file !== 'assets') {
                            readFile(ext, path.join(filePath, file));
                        }
                    });
                });
            } else if ((ext === 'css') && stats.isFile()) {
                fs.readFile(filePath, function (err, data) {
                    if (data) {
                        _aggregated[ext] += data.toString() + '\n';
                    }
                });
            }
        });
    }

    function readFile(ext, filePath) {
        fs.readdir(filePath, function (err, files) {
            if (files) {
                return readFiles(ext, filePath);
            }

            if (path.extname(filePath) !== '.' + ext) {
                return;
            }

            fs.readFile(filePath, function (err, data) {
                if (!data) {
                    readFiles(ext, filePath);
                } else {
                    _aggregated[ext] += (ext === 'js' && !options.global) ? ('(function () { ' + data.toString() + ' }());') : data.toString() + '\n';
                }
            });
        });
    }
}

function capitaliseFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

module.exports = new NodeCore();