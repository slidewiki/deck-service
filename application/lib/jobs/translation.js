'use strict';

const deckDB = require('../../database/deckDatabase.js');
const jobProgress = require('../agendaJobProgress');

module.exports = (agenda) => {
    agenda.define('translation', (job, done) => {
        let data = job.attrs.data;
        deckDB.translateDeckRevision(
            data.deckId,
            data.userId,
            data.language,
            addProgressSupport(job)
        ).then((id_map) => {
            console.log(id_map);
            done();
        }).catch((err) => {
            done(err);
        });
    });
};

// enhance the job instance with a method to update its progress
function addProgressSupport(job) {
    job.incrementProgress = () => jobProgress.incProgressToJob(job.attrs.data.newId, job.agenda);
    return job;
}
