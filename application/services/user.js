'use strict';

const _ = require('lodash');
const rp = require('request-promise-native');

const config = require('../configuration');
const Microservices = require('../configs/microservices');

const deckDb = require('../database/deckDatabase');


const self = module.exports = {
    // promises user data using jwt (and optionally other info as well)
    fetchUserData: function(authToken) {
        let headers = {};
        headers[config.JWT.HEADER] = authToken;

        return rp.get({
            uri: `${Microservices.user.uri}/userdata`,
            json: true,
            headers: headers,
        });
    },

    // promises user public info for a list of user ids
    fetchUserInfo: function(userIds) {
        // return empty list if nothing provided
        if (_.isEmpty(userIds)) {
            return Promise.resolve([]);
        }

        return rp.post({
            uri: `${Microservices.user.uri}/users`,
            json: true,
            body: userIds,
        }).then((users) => users.map((u) => ({id: u._id, username: u.username, picture: u.picture, country: u.country, organization: u.organization}) ) );
    },

    // promises group public info for a list of group ids (not the users in the groups)
    fetchGroupInfo: function(groupIds) {
        // return empty list if nothing provided
        if (_.isEmpty(groupIds)) {
            return Promise.resolve([]);
        }

        return rp.post({
            uri: `${Microservices.user.uri}/usergroups`,
            json: true,
            body: groupIds,
        }).then((groups) => groups.map((g) => ({id: g.id, name: g.name}) ));
    },

    // checks with the user service to collect the user ids for all groups in groupIds
    fetchUsersForGroups: function(groupIds) {
        // return empty list if nothing provided
        if (_.isEmpty(groupIds)) {
            return Promise.resolve([]);
        }

        return rp.post({
            uri: Microservices.user.uri + '/usergroups',
            json: true,
            body: groupIds,
        }).then((response) => {
            // response should be an array
            let userIds = response.map((group) => {
                // also add the creator id for each group
                return (group.members.concat([group.creator])).map((member) => member.userid);
            });

            // we get an array of arrays, let's flat it out and also get rid of duplicates
            return _.uniq(_.flatten(userIds));
        });
    },

};
