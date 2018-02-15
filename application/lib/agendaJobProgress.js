'use strict';

const {promisify} = require('util');

let self = module.exports = {

    getJobForDeck: function(deckId, agenda) {
        let jobsPromise = promisify(agenda.jobs).bind(agenda);

        return jobsPromise({ 'data.newId': Number.parseInt(deckId) }).then((jobs) => {
            // we should only have one of those, just get the first one, if none this will be null/undefined
            return jobs[0];
        });
    },

    incProgressToJob: (jobNewId, agenda) => {

        return self.getJobForDeck(jobNewId, agenda).then((job) => {
            if (!job) {
                throw new Error('Job not found: ' + jobNewId);
            }

            console.log('updateProgress for job: ' + JSON.stringify(job));
            let progress = job.attrs.data.progress || 0;
            job.attrs.data.progress = progress + 1;
            // when reading a job agenda adds current time in nextRunAt if null, which results to job being re-run
            job.attrs.nextRunAt = null;

            let savePromise = promisify(job.save).bind(job);
            return savePromise();
        });

    },

};
