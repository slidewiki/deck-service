'use strict';

const deckDB = require('../database/deckDatabase');
const slideDB = require('../database/slideDatabase');
const boom = require('boom');
const _ = require('lodash');
const util = require('../lib/util');

let self = module.exports = {

    getDeckChangeLog: function(request, reply) {
        let deckId = request.params.id;
        let variantFilter = _.pick(request.query, 'language');

        deckDB.getChangeLog(deckId).then((changeLog) => {
            if (!changeLog) throw boom.notFound();

            // always reverse the order, as the input is timestamp ascending
            if (request.query.raw) return changeLog.reverse();

            return prepareChangeLog(changeLog, variantFilter);

        }).then((changeLog) => {
            if (request.query.simplify) simplify(changeLog);
            reply(changeLog);
        }).catch((error) => {
            if (error.isBoom) return reply(error);
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

    getSlideChangeLog: function(request, reply) {
        let slideId = request.params.id;
        let rootId = request.query.root;
        let variantFilter = _.pick(request.query, 'language');

        slideDB.getChangeLog(slideId, rootId).then((changeLog) => {
            if (!changeLog) throw boom.notFound();

            // always reverse the order, as the input is timestamp ascending
            if (request.query.raw) return changeLog.reverse();

            return prepareChangeLog(changeLog, variantFilter);

        }).then((changeLog) => {
            if (request.query.simplify) simplify(changeLog);
            reply(changeLog);
        }).catch((error) => {
            if (error.isBoom) return reply(error);
            request.log('error', error);
            reply(boom.badImplementation());
        });
    },

};

const mergeMoves = true;
const mergeParents = true;

function prepareChangeLog(changeLog, variantFilter) {
    if (mergeParents) {
        changeLog = mergeChangeParents(changeLog);
    }

    // make sure node references match the current variantFilter,
    // if variantFilter does not match, keep the primary node references, without variants
    let checkVariants = !_.isEmpty(variantFilter);
    if (checkVariants) {
        changeLog.forEach((cur) => {
            // check variant nodes (slides)
            for (let value of [cur.value, cur.oldValue]) {
                if (!value) continue;

                let variant = checkVariants && _.find(value.variants, variantFilter);
                if (variant) {
                    // found! replace ref 
                    Object.assign(value.ref, variant);
                }
                // always delete variants (???)
                delete value.variants;
            }
        });
    }

    // remove primary or other variants
    // if variantFilter does not match, essentially variant-specific changes including to the primary are all purged
    _.remove(changeLog, (cur) => {
        if (['add', 'remove'].includes(cur.op)) {
            // keep all add/remove records
            if (!cur.value.variant) return false;

            // remove/keep records for other variants
            if (checkVariants && !_.isEqual(cur.value.variant, variantFilter) ) return true;
        }

        if (cur.op === 'replace') {
            // remove/keep records for primary
            if (!cur.value.variant) return checkVariants;
            // remove/keep records for other variants
            if (checkVariants && !_.isEqual(cur.value.variant, variantFilter) ) return true;
        } 

        if (cur.op === 'update') {
            // remove/keep records for primary
            if (!cur.variant) return checkVariants;
            // remove/keep records for other variants
            if (checkVariants && !_.isEqual(cur.variant, variantFilter) ) return true;
        }

        return !checkVariants;
    });

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
                if (ref.revision < cur.oldValue.ref.revision || cur.action === 'revert') {
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

    if (mergeMoves) {
        let hold;
        changeLog = changeLog.reduce((acc, cur) => {
            if (hold) {
                // TODO check timestamps as well
                if (['add', 'remove'].includes(cur.op)) {
                    // in order to qualify for a move:
                    if (cur.op !== hold.op // cur.op is distict from hold.op (add/remove or remove/add sequence)
                        && _.isEqual(hold.value, cur.value) // both ops were for the same value (deck tree node)
                        && hold.user === cur.user // both ops were by the same user
                        && cur._id.getTimestamp() - hold._id.getTimestamp() === 0 // timestamps (second-based accuracy) should be the same 
                    ) {
                        // we have a move, so merge and push
                        acc.push({
                            op: 'move',
                            from: hold.path,
                            path: cur.path,
                            value: cur.value,

                            timestamp: cur.timestamp,
                            user: cur.user,
                        });

                        // and unset 'hold'
                        hold = undefined;                        
                    } else {
                        // push hold, set cur to hold
                        acc.push(hold);
                        hold = cur;
                    }

                } else {
                    // just push both
                    acc.push(hold, cur);

                    // and unset 'hold'
                    hold = undefined;                        
                }

            } else if (['add', 'remove'].includes(cur.op)) {
                // just hold it, don't push it yet
                hold = cur;
            } else {
                // push it forward
                acc.push(cur);
            }
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

            if (cur.variant) {
                // it's an update to the deck variant properties
                if (_.isEmpty(cur.values) && _.isEmpty(cur.oldValues)) {
                    // means we only added a deck translation
                    cur.action = 'translate';
                    let [leaf] = cur.path.slice(-1);
                    cur.translated = {
                        kind: 'deck',
                        title: leaf.title,
                        language: cur.variant.language,
                    };
                }
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

        // check for new slide translations
        if (cur.op === 'add' && cur.value.variant) {
            cur.action = 'translate';
            cur.translated = {
                kind: 'slide',
                title: '',
                language: cur.value.variant.language,
            };

            if (cur.oldValue) {
                cur.translated.title = cur.oldValue.ref.title;
            }
        }

        // set `action` to value of `op` if it's missing
        if (!cur.action) cur.action = cur.op;
    });

    // always reverse the order, as the input is timestamp ascending
    return changeLog.reverse();
}

function simplify(changeLog) {
    changeLog.forEach((cur) => {
        // format paths and updates
        cur.path = formatPath(cur.path);
        if (cur.from) cur.from = formatPath(cur.from);

        if (['fork', 'attach'].includes(cur.action)) cur.forkOf = util.toIdentifier(cur.value.origin);

        // format node updates
        if (cur.value) {
            let variant = cur.value.variant;
            cur.value = `${cur.value.kind}:${formatRef(cur.value.ref)}`;
            if (variant) cur.value += `:${Object.entries(variant)}`;
        }
        
        if (cur.oldValue) {
            let variant = cur.oldValue.variant;
            cur.oldValue = `${cur.oldValue.kind}:${formatRef(cur.oldValue.ref)}`;
            if (variant) cur.oldValue += `:${Object.entries(variant)}`;
        }

        if (cur.reverted) cur.reverted = `from ${cur.reverted.from} to ${cur.reverted.to}`;
        if (cur.renamed) {
            cur.renamed = `${cur.renamed.kind} from '${cur.renamed.from}' to '${cur.renamed.to}'`;
            delete cur.values;
            delete cur.oldValues;
        }
        if (cur.translated) {
            cur.translated = `${cur.oldValue} into ${cur.translated.language}`;
            delete cur.oldValue;
        }
    });
}

function formatPath(path) {
    return '/' + (path ? path.map(formatPathPart).join('/') : '');
}

function formatPathPart(pathPart) {
    let prefix = _.isNumber(pathPart.index) ? `${pathPart.index + 1}` : undefined;
    return _.compact([prefix, formatRef(pathPart)]).join(':');
}

function formatRef(ref) {
    if (!ref || !ref.id || !ref.revision) return undefined;
    return `${ref.id}-${ref.revision}`;
}

function mergeChangeParents(changeLog) {
    let stack = [];
    // we push a dummy op to make sure we merge any final revision chains left over in the stack
    changeLog.push({ op: 'dummy' });

    return changeLog.reduce((acc, cur) => {
        let hold;
        let firstRec = stack[0];

        if (firstRec && (_.isEmpty(cur.parents) || !cur.parents.some((pid) => pid.equals(firstRec._id))) ) { 
            // the stack is not empty, and we have a new chain starting
            // the parents attribute in the record links each record
            // to its parent records, i.e. the ones in the same operation group

            // we just keep the current record held for now
            hold = cur;
        } else {
            // it's either a new chain and the stack is empty,
            // or part of the one in the stack
            // so keep it in stack for now and proceed to next record
            stack.push(cur);
            return acc;
        }

        // if we come this far, then we need to merge whatever the stack has
        // because `cur` is not part of the revision chain
        // (either not a revision record, or part of a new revision chain)

        if (firstRec) {
            // just push the first record in the stack forward
            acc.push(firstRec);
            // also hide the parent info
            delete firstRec.parents;
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
