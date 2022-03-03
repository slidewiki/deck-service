'use strict';

const _ = require('lodash');

const boom = require('boom');

const deckDB = require('../database/deckDatabase');
const treeDB = require('../database/deckTreeDatabase');
const groupDB = require('../database/groupsDatabase');
const contributorsDB = require('../database/contributors');

const userService = require('../services/user');
const querystring = require('querystring');

let self = module.exports = {

    // TODO improve the response object
    listDecks: function(request, reply) {
        let options = _.pick(request.query, 'idOnly', 'rootsOnly', 'sort', 'page', 'pageSize', 'user', 'roles', 'status');
        let query = _.pick(request.query, 'user');

        // HACK: when idOnly is set, user service needs to find all decks of a user, including hidden ones
        if (options.idOnly) {
            // if we want only ids, we return *all* deck ids
            delete options.pageSize;

            // so we ignore ALL other input
            return countAndList(query, options).then((response) => {
                reply(response);
            }).catch((err) => {
                if (err.isBoom) return reply(err);
                request.log('error', err);
                reply(boom.badImplementation());
            });
        }

        if (request.query.usergroup) {
            query['editors.groups.id'] = request.query.usergroup;
        }

        // the roles, status parameters have priviliged semantics:
        let roles = request.query.roles && request.query.roles.split(',') || [];
        let currentUser = request.auth.credentials && request.auth.credentials.userid;

        // we need to figure out the edit rights of the current user if:
        //   we ask for editable decks owned by others, or:
        //   we ask for non-public decks owned by others
        let isPrivileged = (currentUser && currentUser !== query.user) && (roles.includes('editor') || request.query.status !== 'public');
        if (!isPrivileged) {
            // we are either asking for own decks, or are not authenticated,
            // or we are asking for public decks in general and no editor is in roles
            if (currentUser && currentUser === query.user) {
                if (request.query.status === 'public') {
                    query.hidden = { $in: [false, null] };
                } else if (request.query.status === 'hidden') {
                    query.hidden = true;
                } // else indifferent ('all')
            } else {
                // if not asking for our own decks, we can only view public ones:
                query.hidden = { $in: [false, null] };
            }

            return countAndList(query, options).then((response) => {
                reply(response);
            }).catch((err) => {
                if (err.isBoom) return reply(err);
                request.log('error', err);
                reply(boom.badImplementation());
            });

        }

        // at this point we assert that we have authentication and query.user is NOT the same as currentUser
        // we also assert that we are either requesting for editable OR non-public decks
        // either way, we need to first get the list of groups current user belongs to 
        return userService.fetchGroupsForUser(currentUser, request.auth.token).then((usergroups) => {
            // this will hold whatever we can access
            let rolesConditions = [];
            if (roles.includes('editor')) {
                rolesConditions.push({ 'editors.groups.id': { $in: usergroups } });
                rolesConditions.push({ 'editors.users.id': currentUser });
            }

            if (roles.includes('owner')) {
                rolesConditions.push({ user: currentUser });
            } else if (roles.includes('editor') && !query.user) {
                // exclude currentUser from owners unless a (different) user is set
                query.user = { $ne: currentUser };
            }

            // hidden decks query part: can show any editable ones (by any user), or owned ones
            let hiddenQuery = {  hidden: true, };
            if (_.isEmpty(rolesConditions)) {
                hiddenQuery.$or = [
                    { 'editors.groups.id': { $in: usergroups } },
                    { 'editors.users.id': currentUser },
                    { user: currentUser },
                ];
            } else {
                // roles conditions always allow for accessing hidden decks
                hiddenQuery.$or = rolesConditions;
            }

            // public decks are always accessible
            let publicQuery = {
                hidden: { $in: [false, null] },
            };

            if (request.query.status === 'public') {
                Object.assign(query, publicQuery);
                // should be non-empty anyway, but better safe than sorry
                if (!_.isEmpty(rolesConditions)) {
                    query.$or = rolesConditions;
                }
            } else if (request.query.status === 'hidden') {
                // non-empty rolesConditions are already in hiddenQuery
                Object.assign(query, hiddenQuery);
            } else {
                // any
                if (_.isEmpty(rolesConditions)) {
                    query.$or = [
                        publicQuery,
                        hiddenQuery,
                    ];
                } else {
                    // non-empty rolesConditions are already in hiddenQuery
                    // roles conditions always allow for accessing hidden decks,
                    // so no need to add any special 'hidden' queries
                    query.$or = rolesConditions;
                }
            }

            return countAndList(query, options).then( (response) => {
                reply(response);
            });

        }).catch( (err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    getContributors: function(request, reply) {
        let deckId = request.params.id;
        let variantFilter = _.pick(request.query, 'language');
        contributorsDB.getDeckContributors(deckId, variantFilter).then((contributors) => {
            if (!contributors) throw boom.notFound();
            return contributors;
        }).then(reply).catch((err) => {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        });
    },

    getDeckOwners: function(request, reply) {
        let query = {};
        if (request.query.user) {
            query.user = { $in: request.query.user.split(',').map((u) => parseInt(u)) };
        }

        deckDB.getDeckOwners(query).then((users) => {
            reply(users);
        }).catch((err) => {
            request.log('error', err);
            reply(boom.badImplementation());
        });

    },

    listGroupDecks: async function(request, reply) {
        let groupId = request.params.id;

        // we need to also check visibility of decks listed
        let currentUser = request.auth.credentials && request.auth.credentials.userid;

        try {
            let group = await groupDB.get(groupId);
            if (!group) throw boom.notFound();

            let query = { _id: { $in: group.decks } };
            // check user permissions (currentUser can be empty here)
            let perms = await groupDB.userPermissions(groupId, currentUser, request.auth.token);
            if (!perms.edit) {
                // only return public decks
                query.hidden = { $in: [false, null] };
            }

            // list the decks and forward the deck order for reordering
            let decks = await deckDB.list(query);
            // let's sort the decks (happens in-place)
            decks.sort((a, b) => {
                // order is the same as in the group.decks array
                return group.decks.indexOf(a._id) - group.decks.indexOf(b._id);
            });

            // let's also transform them
            let transformed = [];
            for (let d of decks) {
                transformed.push(await transform(d));
            }

            reply(transformed);

        } catch (err) {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        }

    },

    // TODO support full deck updates
    updateDeck: async function(request, reply) {
        let userId = request.auth.credentials.userid;
        let deckId = request.params.id;

        try {
            let perms = await deckDB.userPermissions(deckId, userId);
            if (!perms) throw boom.notFound();
            if (!perms.admin) throw boom.forbidden(`user:${userId} is not authorized to delete deck:${deckId}`);

            await deckDB.adminUpdate(deckId, request.payload);

            reply(await deckDB.getDeck(deckId));
        } catch (err) {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        }

    },

    deleteDeck: async function(request, reply) {
        let userId = request.auth.credentials.userid;
        let deckId = request.params.id;

        try {
            let perms = await deckDB.userPermissions(deckId, userId);
            if (!perms) throw boom.notFound();
            if (!perms.admin) throw boom.forbidden(`user:${userId} is not authorized to delete deck:${deckId}`);

            let deck = await deckDB.getDeck(deckId);
            if (!deck) throw boom.notFound();

            // check if deck is not root
            if (_.size(deck.usage)) throw boom.methodNotAllowed(`cannot delete deck ${deckId} as it is shared in other deck trees`);

            // also check if deck has subdecks
            if (_.find(deck.contentItems, { kind: 'deck' })) throw boom.methodNotAllowed(`cannot delete deck ${deckId} as it includes subdecks`);

            let result = await deckDB.adminUpdate(deckId, { user: -1 });
            if (!result) throw boom.notFound();

            // no content retured, it's a DELETE op
            reply();
        } catch (err) {
            if (err.isBoom) return reply(err);
            request.log('error', err);
            reply(boom.badImplementation());
        }

    },

};

async function countAndList(query, options){
    options.countOnly = true;
    let result = await deckDB.list(query, options);

    delete options.countOnly;
    let totalCount = (result.length === 0) ? 0 : result[0].totalCount;

    let decks = await deckDB.list(query, options);

    let items = [];
    for (let deck of decks) {
        items.push((options.idOnly) ? { _id: deck._id } : await transform(deck));
    }

    if (!options.pageSize) {
        return items;
    }

    // form links for previous and next results
    let links = {};
    let page = options.page;

    if (options.page > 1) {
        options.page = page - 1;
        links.previous = `/decks?${querystring.stringify(options)}`;
    }

    if (options.page * options.pageSize < totalCount) {
        options.page = page + 1;
        links.next = `/decks?${querystring.stringify(options)}`;
    }

    let response = {};
    response._meta = {
        page: page, 
        pageSize: options.pageSize,
        totalCount: totalCount,
        sort: options.sort,
        status: options.status,
        links: links
    };
    response.items = items;
    return response;
}

async function transform(deck){
    let metadata = {};
    metadata._id = deck._id;

    metadata.owner = deck.user;
    metadata.timestamp = deck.timestamp;
    metadata.description = deck.description;
    metadata.lastUpdate = deck.lastUpdate;
    metadata.tags = deck.tags;
    metadata.translation = deck.translation;
    metadata.countRevisions = deck.countRevisions;
    metadata.active = deck.active;
    metadata.hidden = deck.hidden;

    // only active revision is returned
    let revision = deck.revisions;

    metadata.title = revision.title;
    metadata.comment = revision.comment;
    metadata.abstract = revision.abstract;
    metadata.license = revision.license;
    metadata.priority = revision.priority;
    metadata.visibility = revision.visibility;
    if (revision.language){
        metadata.language = revision.language.length === 2 ? revision.language : revision.language.substring(0, 2);
    }else{
        metadata.language = 'en';
    }
    metadata.translation = revision.translation;
    metadata.tags = revision.tags;
    metadata.parent = revision.parent;
    metadata.theme = revision.theme;
    metadata.allowMarkdown = revision.allowMarkdown;

    // get first slide
    let deckRev = {
        id: deck._id,
        revision: revision.id,
        language: revision.language,
        contentItems: revision.contentItems,
    };
    metadata.firstSlide = await treeDB.getFirstSlide(deckRev);

    return metadata;
}
