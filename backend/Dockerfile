FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/backend-0.0.1-SNAPSHOT.jar /app/app.jar
COPY src/main/resources/seed-thumbnails /app/seed-thumbnails
COPY init-seed-thumbnails.sh /usr/local/bin/init-seed-thumbnails
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod +x /usr/local/bin/init-seed-thumbnails /usr/local/bin/docker-entrypoint
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint"]
