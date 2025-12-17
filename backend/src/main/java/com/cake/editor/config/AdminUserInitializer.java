package com.cake.editor.config;

import com.cake.editor.model.User;
import com.cake.editor.model.UserRole;
import com.cake.editor.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class AdminUserInitializer {

    private static final Logger log = LoggerFactory.getLogger(AdminUserInitializer.class);

    @Bean
    public CommandLineRunner ensureAdminUser(UserRepository userRepository,
                                             PasswordEncoder passwordEncoder,
                                             ApplicationProperties properties) {
        return args -> {
            String adminEmail = properties.getAdmin().getEmail().trim().toLowerCase();
            String adminPassword = properties.getAdmin().getPassword();

            userRepository.findByEmailIgnoreCase(adminEmail).ifPresentOrElse(existing -> {
                if (existing.getRole() != UserRole.ADMIN) {
                    existing.setRole(UserRole.ADMIN);
                    userRepository.save(existing);
                    log.info("Promoted existing user {} to ADMIN role", adminEmail);
                }
            }, () -> {
                User admin = new User();
                admin.setEmail(adminEmail);
                admin.setPasswordHash(passwordEncoder.encode(adminPassword));
                admin.setRole(UserRole.ADMIN);
                userRepository.save(admin);
                log.info("Created default admin user {}", adminEmail);
            });
        };
    }
}
