package com.cake.editor.config;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

@ConfigurationProperties(prefix = "app")
public class ApplicationProperties {

    private final Storage storage = new Storage();
    private final Cors cors = new Cors();
    private final Jwt jwt = new Jwt();
    private final Admin admin = new Admin();

    public Storage getStorage() {
        return storage;
    }

    public Cors getCors() {
        return cors;
    }

    public Jwt getJwt() {
        return jwt;
    }

    public Admin getAdmin() {
        return admin;
    }

    public static class Storage {
        /**
         * Base path for persisting saved scenes and generated model files.
         */
        @NotBlank
        private String basePath = "data/scenes";

        public String getBasePath() {
            return basePath;
        }

        public void setBasePath(String basePath) {
            this.basePath = basePath;
        }

        public Path resolve(String child) {
            return Path.of(basePath).resolve(child);
        }
    }

    public static class Cors {
        @NotEmpty
        private List<String> allowedOrigins = new ArrayList<>(List.of("http://localhost:4200", "http://localhost:4000"));

        @NotEmpty
        private List<String> allowedMethods = new ArrayList<>(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));

        private List<String> allowedHeaders = new ArrayList<>(List.of("*"));

        public List<String> getAllowedOrigins() {
            return allowedOrigins;
        }

        public void setAllowedOrigins(List<String> allowedOrigins) {
            this.allowedOrigins = allowedOrigins;
        }

        public List<String> getAllowedMethods() {
            return allowedMethods;
        }

        public void setAllowedMethods(List<String> allowedMethods) {
            this.allowedMethods = allowedMethods;
        }

        public List<String> getAllowedHeaders() {
            return allowedHeaders;
        }

        public void setAllowedHeaders(List<String> allowedHeaders) {
            this.allowedHeaders = allowedHeaders;
        }
    }

    public static class Jwt {
        @NotBlank
        private String secret = System.getenv().getOrDefault("APP_JWT_SECRET", "change-me");

        private long expirationMs = 1_800_000; // 30 minutes

        public String getSecret() {
            return secret;
        }

        public void setSecret(String secret) {
            this.secret = secret;
        }

        public long getExpirationMs() {
            return expirationMs;
        }

        public void setExpirationMs(long expirationMs) {
            this.expirationMs = expirationMs;
        }
    }

    public static class Admin {
        @NotBlank
        private String email = System.getenv().getOrDefault("APP_ADMIN_EMAIL", "admin@cake-editor.local");

        @NotBlank
        private String password = System.getenv().getOrDefault("APP_ADMIN_PASSWORD", "ChangeMe123!");

        public String getEmail() {
            return email;
        }

        public void setEmail(String email) {
            this.email = email;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }
    }
}
