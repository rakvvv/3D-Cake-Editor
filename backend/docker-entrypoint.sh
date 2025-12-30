#!/bin/sh
set -eu

/app/init-seed-thumbnails.sh

exec java -jar /app/app.jar
