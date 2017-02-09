'use strict';

const _ = require('lodash');
const rp = require('request-promise-native');

const Microservices = require('../configs/microservices');
const deckDb = require('../database/deckDatabase');


const self = module.exports = {
    // checks with the user service to collect the user ids for all groups in groupIds
    fetchUsersForGroups: function(groupIds) {
        return rp.post({
            uri: Microservices.user.uri + '/usergroups',
            json: true,
            body: groupIds,
        }).then((response) => {
            // response should be an array
            let userIds = response.map((group) => group.members.map((member) => member.userid));
            // we get an arrat of arrays, let's flat it out and also get rid of duplicates
            return _.uniq(_.flatten(userIds));
        });
    },

};
