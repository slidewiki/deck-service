'use strict';

const deckDB = require('../database/deckDatabase');
const boom = require('boom');
const _ = require('lodash');
const async = require('async');

// TODO include them as API options ?
const mergeMoves = true;
const simplifyOutput = true;

let self = module.exports = {

    getDeckChangeLog: function(request, reply) {
        let deckId = request.params.id;

        // change logs are distributed in the deck tree,
        // so we need to get them for all subdeckids
        deckDB.getTreeChangeLog(deckId).then((changeLog) => {
            if (!changeLog) return boom.notFound();

            if (mergeMoves) {
                let hold;
                changeLog = changeLog.reduce((acc, cur) => {

                    if (hold) {
                        // TODO check timestamps as well
                        if (cur.op === 'remove' && _.isEqual(hold.value, cur.value)) {
                            // we have a move, so merge and push
                            acc.push({
                                op: 'move',
                                from: cur.path,
                                path: hold.path,
                                value: cur.value,

                                timestamp: cur.timestamp,
                            });

                        } else {
                            // just push both
                            acc.push(hold, cur);
                        }

                        // in any case, unset 'hold'
                        hold = undefined;
                    } else if (cur.op === 'add') {
                        // just hold it, don't push it yet
                        hold = cur;
                    } else {
                        // push it forward
                        acc.push(cur);
                    };
                    return acc;

                }, []);

                // also add hold if leftover
                if (hold) changeLog.push(hold);
            }

            if (!simplifyOutput) return changeLog;

            changeLog.forEach((cur) => {
                cur.path = formatPath(cur.path);

                if (cur.op === 'replace') {
                    if (cur.value.kind && cur.value.ref) {
                        // update on deck child
                        cur.value = `${cur.value.kind}:${formatRef(cur.value.ref)}`;
                        cur.oldValue = `${cur.oldValue.kind}:${formatRef(cur.oldValue.ref)}`;
                    }
                }

                if (cur.op === 'add') {
                    cur.value = `${cur.value.kind}:${formatRef(cur.value.ref)}`;
                }

                if (cur.op === 'remove') {
                    cur.value = `${cur.value.kind}:${formatRef(cur.value.ref)}`;
                }

                if (cur.op === 'move') {
                    cur.from = formatPath(cur.from),
                    cur.value = `${cur.value.kind}:${formatRef(cur.value.ref)}`;
                }

            });

            return changeLog;

        }).then(reply).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

};

function formatPath(path) {
    return '/' + path.map(formatPathPart).join('/');
}

function formatPathPart(pathPart) {
    let prefix = _.isNumber(pathPart.index) ? `${pathPart.index + 1}` : undefined;
    return _.compact([prefix, formatRef(pathPart)]).join(':');
}

function formatRef(ref) {
    if (!ref.id || !ref.revision) return undefined;
    return `${ref.id}-${ref.revision}`;
}
