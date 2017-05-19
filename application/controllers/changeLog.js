'use strict';

const deckDB = require('../database/deckDatabase');
const slideDB = require('../database/slideDatabase');
const boom = require('boom');
const _ = require('lodash');

let self = module.exports = {

    getDeckChangeLog: function(request, reply) {
        let deckId = request.params.id;

        deckDB.getChangeLog(deckId).then((changeLog) => {
            if (!changeLog) return boom.notFound();

            return prepareChangeLog(changeLog);

        }).then(reply).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getSlideChangeLog: function(request, reply) {
        let slideId = request.params.id;
        let rootId = request.query.root;

        slideDB.getChangeLog(slideId, rootId).then((changeLog) => {
            if (!changeLog) return boom.notFound();

            return prepareChangeLog(changeLog);

        }).then(reply).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

};

// TODO include them as API options ?
const mergeMoves = true;
const simplifyOutput = false;

function prepareChangeLog(changeLog) {
    // we at least add the revise/revert subops
    changeLog.forEach((cur) => {
        if (cur.op === 'replace') {
            let ref = cur.value.ref;
            if (cur.value.kind === 'deck') {
                if (ref.originRevision && ref.originRevision < ref.revision - 1) {
                    // we have a revert!
                    cur.reverted = {
                        from: cur.oldValue.ref.revision,
                        to: ref.originRevision,
                    };
                }
            }

            if (cur.value.kind === 'slide') {
                if (ref.revision < cur.oldValue.ref.revision) {
                    // we have a revert!
                    cur.reverted = {
                        from: cur.oldValue.ref.revision,
                        to: ref.revision,
                    };
                }
            }
        }
    });

    if (!mergeMoves && !simplifyOutput) return changeLog;

    if (mergeMoves) {
        let hold;
        changeLog = changeLog.reduce((acc, cur) => {
            if (hold) {
                // TODO check timestamps as well
                if (cur.op === 'add' && _.isEqual(hold.value, cur.value) && hold.user === cur.user) {
                    // we have a move, so merge and push
                    acc.push({
                        op: 'move',
                        from: hold.path,
                        path: cur.path,
                        value: cur.value,

                        timestamp: cur.timestamp,
                        user: cur.user,
                    });

                } else {
                    // just push both
                    acc.push(hold, cur);
                }

                // in any case, unset 'hold'
                hold = undefined;
            } else if (cur.op === 'remove') {
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

    if (simplifyOutput) {
        changeLog.forEach((cur) => {
            // format paths and updates
            cur.path = formatPath(cur.path);
            if (cur.from) cur.from = formatPath(cur.from);

            // format node updates
            if (cur.value) cur.value = `${cur.value.kind}:${formatRef(cur.value.ref)}`;
            if (cur.oldValue) cur.oldValue = `${cur.oldValue.kind}:${formatRef(cur.oldValue.ref)}`;

            if (cur.reverted) cur.reverted = `from ${cur.reverted.from} to ${cur.reverted.to}`;
        });
    }

    // always reverse the order, as the input is timestamp ascending
    return changeLog.reverse();
}

function formatPath(path) {
    return '/' + (path ? path.map(formatPathPart).join('/') : '');
}

function formatPathPart(pathPart) {
    let prefix = _.isNumber(pathPart.index) ? `${pathPart.index + 1}` : undefined;
    return _.compact([prefix, formatRef(pathPart)]).join(':');
}

function formatRef(ref) {
    if (!ref.id || !ref.revision) return undefined;
    return `${ref.id}-${ref.revision}`;
}
