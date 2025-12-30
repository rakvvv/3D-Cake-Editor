#!/bin/sh
set -eu

/usr/local/bin/init-seed-thumbnails

exec java -jar /app/app.jar
