'use strict';

var _ = require('lodash');

function Menus() {
}

function NamespaceMenu(NodeJsCore) {
    var _option = {
        roles: [
            'annonymous'
        ],
        title: '',
        menu: 'main',
        link: '',
        icon: ''
    };

    Menus.prototype.add = function (options) {
        if (arguments.length === 0) {
            return this;
        }

        if (options instanceof Array) {
            options.forEach(Menus.prototype.add.bind(this));
                return this;
        }

        if (arguments.length > 1) {
            Array.prototype.forEach.call(
                arguments,
                argumentsMenuItemsProcessor.bind(null, this)
            );

            return this;
        }

        var item;

        options = _.assign({
            path: 'main',
            roles: ['annonymous']
        }, options);

        options.path = options.path.replace(/^\//, '');
        item = allMenus.findOneOrCreate(options.path.split('/'));
        item.add(new MenuItem(options));

        return this;
    };

    Menus.prototype.get = function (options) {
        options = options || {};
        options.menu = options.menu || 'main';
        options.roles = options.roles || ['annonymous'];
        options.defaultMenu = options.defaultMenu || [];

        var subMenus = allMenus.get(options.roles, options.menu.split('/'));

        if (!subMenus) {
            return options.defaultMenu;
        }

        var ret = subMenus.get(options.roles);

        return ret ? options.defaultMenu.concat(ret.submenus.map(mapDoStrip)) : options.defaultMenu;
    };

    NodeJsCore.prototype.Menus = Menus;
}

function extractNames(v) {
    return v.name;
}

function get_get(roles, v) {
    return v.get(roles);
}

function remove_nulls(v) {
    return v;
}

function MenuItem(options) {
    options = _.assign({
        name: null,
        title: null,
        link: null,
        roles: null
    }, options);

    options.name = options.name || (options.link ? options.link.replace('/', '_') : '') || options.title;
    this.name = options.name;
    this.title = options.title;
    this.link = options.link;
    this.roles = options.roles;
    this.submenus = options.submenus || [];
}

function mapDoStrip(v) {
    return v ? v.strip() : undefined;
}

MenuItem.prototype.strip = function () {
    return {
        name: this.name,
        title: this.title,
        link: this.link,
        roles: this.roles,
        submenus: this.submenus.map(mapDoStrip)
    };
};

MenuItem.hasRole = function (role, roles) {
    return roles.indexOf(role) > -1;
};

MenuItem.prototype.props = function () {
    return {
        name: this.name,
        title: this.title,
        link: this.link,
        roles: this.roles
    };
};

MenuItem.prototype.findOneOrCreate = function (path) {
    if (!path.length) {
        return this;
    }

    var p = path.shift(),
        index = this.list().indexOf(p);

    if (index > -1) {
        return this.submenus[index].findOneOrCreate(path);
    }

    var n = new MenuItem();

    n.name = p;
    this.submenus.push(n);

    return n.findOneOrCreate(path);
};

MenuItem.prototype.get = function (roles, path) {
    roles = roles ? roles.slice() : [];

    if (roles.indexOf('annonymous') < 0 && roles.indexOf('authenticated') < 0) {
        roles.push('authenticated');
    }

    if (roles.indexOf('all') < 0) {
        roles.push('all');
    }

    var list = this.list();

    if (path) {
        if (!path.length) {
            return this;
        }

        var n = path.shift(),
            index = list.indexOf(n);

        return this.submenus[index] ? this.submenus[index].get(roles, path) : undefined;
    }

    if (!MenuItem.hasRole('admin', roles) && this.roles) {
        if (!_.intersection(this.roles, roles).length) {
            return undefined;
        }
    }

    return new MenuItem({
        roles: this.roles || null,
        link: this.link || null,
        title:this.title || null,
        name: this.name || null,
        submenus: this.submenus.map(get_get.bind(null, roles)).filter(remove_nulls),
    });
};

MenuItem.prototype.list = function () {
    return this.submenus.map(extractNames);
};

MenuItem.prototype.add = function (mi) {
    var index = this.list().indexOf(mi.name);
    var itm;

    if (index > -1) {
        var ts = mi.props();

        itm = this.submenus[index];

        for (var i in ts) {
            itm[i] = ts[i];
        }
    } else {
        itm = mi;
        this.submenus.push (itm);
    }

    return itm;
};

var allMenus = new MenuItem();

function mapSubmenuNames(v) {
    return v.name;
}

function argumentsMenuItemsProcessor(instance, item) {
    Menus.prototype.add.call(instance, item);
}

module.exports = NamespaceMenu;