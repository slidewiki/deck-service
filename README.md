# Deck/Slide Management Microservice #
[![Build Status](https://orca.snap-ci.com/slidewiki/deck-service/branch/master/build_image)](https://orca.snap-ci.com/slidewiki/deck-service/branch/master)
[![License](https://img.shields.io/badge/License-MPL%202.0-green.svg)](https://github.com/slidewiki/deck-service/blob/master/LICENSE)
[![Language](https://img.shields.io/badge/Language-Javascript%20ECMA2015-lightgrey.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Framework](https://img.shields.io/badge/Framework-NodeJS%205.6.0-blue.svg)](https://nodejs.org/)
[![Webserver](https://img.shields.io/badge/Webserver-Hapi%2013.0.0-blue.svg)](http://hapijs.com/)
[![LinesOfCode](https://img.shields.io/badge/LOC--lightgrey.svg)](https://github.com/slidewiki/deck-service/blob/master/application/package.json)
[![Coverage Status](https://coveralls.io/repos/github/slidewiki/deck-service/badge.svg?branch=master)](https://coveralls.io/github/slidewiki/deck-service?branch=master)

This Microservice handles deck and slide management, backed by mongodb.

You want to **checkout this cool service**? Simply start the service and head over to: [http://localhost:3000/documentation](http://localhost:3000/documentation). We're using  [swagger](https://www.npmjs.com/package/hapi-swagger) to have this super cool API discrovery/documentation tool.

### Use Docker to run/test your application ###
---
You can use [Docker](https://www.docker.com/) to build, test and run your application locally. Simply edit the Dockerfile and run:

```
docker build -t MY_IMAGE_TAG ./
docker run -it --rm -p 8880:3000 MY_IMAGE_TAG
```

Alternatively you can use [docker-compose](https://docs.docker.com/compose/) to run your application in conjunction with a (local) mongodb instance. Simply execute:

```
docker-compose up -d
```
