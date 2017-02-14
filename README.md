# Deck/Slide Management Microservice #
[![Build Status](https://travis-ci.org/slidewiki/deck-service.svg?branch=master)](https://travis-ci.org/slidewiki/deck-service)
[![License](https://img.shields.io/badge/License-MPL%202.0-green.svg)](https://github.com/slidewiki/deck-service/blob/master/LICENSE)
[![Language](https://img.shields.io/badge/Language-Javascript%20ECMA2015-lightgrey.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Framework](https://img.shields.io/badge/Framework-NodeJS%206.9.0-blue.svg)](https://nodejs.org/)
[![Webserver](https://img.shields.io/badge/Webserver-Hapi%2016.1.0-blue.svg)](http://hapijs.com/)
[![Coverage Status](https://coveralls.io/repos/github/slidewiki/deck-service/badge.svg?branch=master)](https://coveralls.io/github/slidewiki/deck-service?branch=master)

This Microservice handles deck and slide management, backed by mongodb...

You want to **checkout this cool service**? Simply start the service and head over to: [http://localhost:3000/documentation](http://localhost:3000/documentation). We're using  [swagger](https://www.npmjs.com/package/hapi-swagger) to have this super cool API discrovery/documentation tool.

### Use Docker to run/test your application ###
---
You can use [Docker](https://www.docker.com/) to build, test and run your application locally. Simply edit the Dockerfile and run:

```
docker build -t test-deck-service ./

### klaas comment: needs mongoDB
docker run -d --name mongodb mongo

### use latest image from dockerhub:
docker run -d -p 3000:3000 -e DATABASE_PORT=27017 slidewiki/deckservice

### use local image:
docker run -it --rm -p 8880:3000 test-deck-service
docker run -d -p 3000:3000 -e DATABASE_PORT=27017 test-deck-service
```

Alternatively you can use [docker-compose](https://docs.docker.com/compose/) to run your application in conjunction with a (local) mongodb instance. Simply execute:

```
docker-compose up -d
```

### Install NodeJS ###
---
Please visit the wiki at [**Install NodeJS**](https://github.com/slidewiki/microservice-template/wiki/Install-NodeJS).
