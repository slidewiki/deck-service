'use strict';

const deckDB = require('../database/deckDatabase');
const slideDB = require('../database/slideDatabase');
const boom = require('boom');
const _ = require('lodash');
const util = require('../lib/util');

let self = module.exports = {

    getDeckChangeLog: function(request, reply) {
        let deckId = request.params.id;

        deckDB.getChangeLog(deckId).then((changeLog) => {
            if (!changeLog) return boom.notFound();

            return prepareChangeLog(changeLog, request.query.simplify, deckId);

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

            return prepareChangeLog(changeLog, request.query.simplify);

        }).then(reply).catch((error) => {
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

};

const mergeMoves = true;
const mergeRevisions = true;
const mergeForks = true;

function prepareChangeLog(changeLog, simplifyOutput, deckId) {
    // we add the revise/revert subops
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
                    cur.action = 'revert';
                } else {
                    cur.action = 'revise';
                }
            }

            if (cur.value.kind === 'slide') {
                if (ref.revision < cur.oldValue.ref.revision) {
                    // we have a revert!
                    cur.reverted = {
                        from: cur.oldValue.ref.revision,
                        to: ref.revision,
                    };
                    cur.action = 'revert';
                } else {
                    // it's a slide edit action
                    cur.action = 'edit';
                }
            }
        }
    });

    let deck = util.parseIdentifier(deckId);
    if (mergeRevisions && deck) {
        // we need to merge the recursive revisioning logs
        changeLog = mergeDeckRevisions(changeLog, deck);
    }

    if (mergeForks && deck) {
        // we need to merge the recursive revisioning logs
        changeLog = mergeDeckForks(changeLog, deck);
    }

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

    // fill `action` were missing, and detect 'rename' actions
    changeLog.forEach((cur) => {
        if (cur.op === 'update') {
            // check for deck rename in values
            if (cur.values.title && _.size(cur.values) === 1) {
                cur.action = 'rename';
                cur.renamed = {
                    kind: 'deck',
                    from: cur.oldValues.title,
                    to: cur.values.title,
                };
            }

        } else if (cur.action === 'edit') {
            // check for slide rename
            if (cur.value.ref.title !== cur.oldValue.ref.title) {
                cur.action = 'rename';
                cur.renamed = {
                    kind: 'slide',
                    from: cur.oldValue.ref.title,
                    to: cur.value.ref.title,
                };
            }

        }

        // set `action` to value of `op` if it's missing
        if (!cur.action) cur.action = cur.op;
    });

    if (simplifyOutput) {
        changeLog.forEach((cur) => {
            // format paths and updates
            cur.path = formatPath(cur.path);
            if (cur.from) cur.from = formatPath(cur.from);

            if (cur.action === 'fork') cur.forkOf = util.toIdentifier(cur.value.origin);

            // format node updates
            if (cur.value) cur.value = `${cur.value.kind}:${formatRef(cur.value.ref)}`;
            if (cur.oldValue) cur.oldValue = `${cur.oldValue.kind}:${formatRef(cur.oldValue.ref)}`;

            if (cur.reverted) cur.reverted = `from ${cur.reverted.from} to ${cur.reverted.to}`;
            if (cur.renamed) {
                cur.renamed = `${cur.renamed.kind} from '${cur.renamed.from}' to '${cur.renamed.to}'`;
                delete cur.values;
                delete cur.oldValues;
            }

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

function mergeDeckRevisions(changeLog, deck) {
    let stack = [];
    // we push a dummy op to make sure we merge any final revision chains left over in the stack
    changeLog.push({ op: 'dummy' });

    return changeLog.reduce((acc, cur) => {
        let hold;
        let firstRec = stack[0];

        if (cur.op === 'replace' && cur.value.kind === 'deck') {
            // this is a revisioning record

            if (firstRec && cur.value.ref.id === deck.id) { 
                // the stack is not empty, and we have a new chain starting
                // we just keep the current record held for now
                hold = cur;
            } else {
                // it's either a new chain and the stack is empty,
                // or part of the one in the stack
                // so keep it in stack for now and proceed to next record
                stack.push(cur);
                return acc;
            }

        }

        // if we come this far, then we need to merge whatever the stack has
        // because `cur` is not part of the revision chain
        // (either not a revision record, or part of a new revision chain)

        if (!_.isEmpty(stack)) {
            // let's create the grouped revisioning thing
            let [lastRec] = stack.slice(-1);
            let mergedRec = {
                op: 'replace',
                path: firstRec.path,
                value: firstRec.value,
                oldValue: firstRec.oldValue,

                timestamp: lastRec.timestamp,
                user: lastRec.user,
            };
            // add revert information
            if (firstRec.reverted) {
                mergedRec.reverted = firstRec.reverted;
                mergedRec.action = 'revert';
            } else {
                mergedRec.action = 'revise';
            }
            // push it forward
            acc.push(mergedRec);
            // and clear the stack
            stack.length = 0;
        }

        // if `hold` has a value, then `cur` *IS* a revisioning record
        // stack is empty by now, so we can just push it there
        if (hold) {
            stack.push(hold);
        } else if (cur.op !== 'dummy') {
            // we push the `cur` forward if it's not the dummy record
            acc.push(cur);
        }

        return acc;

    }, []);

}

function mergeDeckForks(changeLog, deck) {
    let stack = [];
    // we push a dummy op to make sure we merge any final revision chains left over in the stack
    changeLog.push({ op: 'dummy' });

    return changeLog.reduce((acc, cur) => {
        let hold;
        let firstRec = stack[0];

        if (['fork', 'attach'].includes(cur.action)) {
            // this is a forking record

            if (firstRec && firstRec.action === cur.action && cur.value.ref.id === deck.id) { 
                // the stack is not empty, and we have a new chain starting
                // we just keep the current record held for now
                hold = cur;
            } else {
                // it's either a new chain and the stack is empty,
                // or part of the one in the stack
                // so keep it in stack for now and proceed to next record
                stack.push(cur);
                return acc;
            }

        }

        // if we come this far, then we need to merge whatever the stack has
        // because `cur` is not part of the revision chain
        // (either not a revision record, or part of a new revision chain)

        if (!_.isEmpty(stack)) {
            // let's create the grouped revisioning thing
            let [lastRec] = stack.slice(-1);
            let mergedRec = {
                op: firstRec.op,
                path: firstRec.path,
                value: firstRec.value,

                timestamp: lastRec.timestamp,
                user: lastRec.user,

                action: firstRec.action,
            };
            // push it forward
            acc.push(mergedRec);
            // and clear the stack
            stack.length = 0;
        }

        // if `hold` has a value, then `cur` *IS* a revisioning record
        // stack is empty by now, so we can just push it there
        if (hold) {
            stack.push(hold);
        } else if (cur.op !== 'dummy') {
            // we push the `cur` forward if it's not the dummy record
            acc.push(cur);
        }

        return acc;

    }, []);

}
