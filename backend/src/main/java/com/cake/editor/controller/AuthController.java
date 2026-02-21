package com.cake.editor.controller;

import com.cake.editor.dto.*;
import com.cake.editor.model.User;
import com.cake.editor.model.UserRole;
import com.cake.editor.repository.UserRepository;
import com.cake.editor.security.JwtService;
import com.cake.editor.security.CustomUserDetailsService;
import com.cake.editor.service.EmailService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@RestController
@RequestMapping(path = "/api/auth", produces = MediaType.APPLICATION_JSON_VALUE)
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final AuthenticationManager authenticationManager;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final CustomUserDetailsService userDetailsService;
    private final EmailService emailService;

    public AuthController(AuthenticationManager authenticationManager,
                          UserRepository userRepository,
                          PasswordEncoder passwordEncoder,
                          JwtService jwtService,
                          CustomUserDetailsService userDetailsService,
                          EmailService emailService) {
        this.authenticationManager = authenticationManager;
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.userDetailsService = userDetailsService;
        this.emailService = emailService;
    }

    @PostMapping(value = "/register", consumes = MediaType.APPLICATION_JSON_VALUE)
    public MessageResponse register(@Valid @RequestBody AuthRequest request) {
        String normalizedEmail = request.getEmail().trim();
        userRepository.findByEmailIgnoreCase(normalizedEmail)
                .ifPresent(user -> {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Email already registered");
                });

        validatePasswordStrength(request.getPassword());

        String verificationToken = UUID.randomUUID().toString();

        User user = new User();
        user.setEmail(normalizedEmail);
        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        user.setRole(UserRole.USER);
        user.setEmailVerified(false);
        user.setVerificationToken(verificationToken);
        userRepository.save(user);

        try {
            emailService.sendVerificationEmail(user.getEmail(), verificationToken);
            return new MessageResponse("Rejestracja udana! Sprawdź swoją skrzynkę email i kliknij link, aby potwierdzić konto.");
        } catch (Exception e) {
            log.warn("Could not send verification email to {}: {}", user.getEmail(), e.getMessage());
            return new MessageResponse(
                    "Konto utworzone, ale nie udało się wysłać emaila weryfikacyjnego. " +
                    "Skontaktuj się z administratorem, aby aktywować konto.");
        }
    }

    @GetMapping("/verify")
    public MessageResponse verifyEmail(@RequestParam String token) {
        User user = userRepository.findByVerificationToken(token)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Nieprawidłowy token weryfikacyjny"));

        if (user.isEmailVerified()) {
            return new MessageResponse("Email został już potwierdzony. Możesz się zalogować.");
        }

        user.setEmailVerified(true);
        user.setVerificationToken(null);
        userRepository.save(user);

        return new MessageResponse("Email potwierdzony! Możesz się teraz zalogować.");
    }

    @PostMapping(value = "/login", consumes = MediaType.APPLICATION_JSON_VALUE)
    public AuthResponse login(@Valid @RequestBody AuthRequest request) {
        String normalizedEmail = request.getEmail().trim();

        try {
            Authentication authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(normalizedEmail, request.getPassword())
            );
            SecurityContextHolder.getContext().setAuthentication(authentication);
        } catch (AuthenticationException ex) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials", ex);
        }

        User user = userRepository.findByEmailIgnoreCase(normalizedEmail)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials"));

        if (!user.isEmailVerified()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Email not verified");
        }

        var userDetails = userDetailsService.loadUserByUsername(normalizedEmail);
        String token = jwtService.generateToken(userDetails);
        return new AuthResponse(token, toDto(user));
    }

    @PostMapping(value = "/forgot-password", consumes = MediaType.APPLICATION_JSON_VALUE)
    public MessageResponse forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        String normalizedEmail = request.getEmail().trim();

        userRepository.findByEmailIgnoreCase(normalizedEmail).ifPresent(user -> {
            try {
                String resetToken = UUID.randomUUID().toString();
                user.setPasswordResetToken(resetToken);
                user.setPasswordResetExpiry(Instant.now().plus(1, ChronoUnit.HOURS));
                userRepository.save(user);
                emailService.sendPasswordResetEmail(user.getEmail(), resetToken);
            } catch (Exception e) {
                log.warn("Could not send password reset email to {}: {}", user.getEmail(), e.getMessage());
            }
        });

        return new MessageResponse("Jeśli konto z tym adresem email istnieje, wysłaliśmy link do resetu hasła.");
    }

    @PostMapping(value = "/reset-password", consumes = MediaType.APPLICATION_JSON_VALUE)
    public MessageResponse resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        log.info("Reset password request for token: {}", request.getToken());
        User user = userRepository.findByPasswordResetToken(request.getToken())
                .orElseThrow(() -> {
                    log.warn("Password reset token not found: {}", request.getToken());
                    return new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Nieprawidłowy lub wygasły token");
                });

        if (user.getPasswordResetExpiry() == null || user.getPasswordResetExpiry().isBefore(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Token wygasł. Poproś o nowy link.");
        }

        validatePasswordStrength(request.getPassword());

        user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        user.setPasswordResetToken(null);
        user.setPasswordResetExpiry(null);
        userRepository.save(user);

        return new MessageResponse("Hasło zostało zmienione. Możesz się teraz zalogować.");
    }

    @GetMapping("/me")
    public UserDto me() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not authenticated");
        }

        var user = userRepository.findByEmailIgnoreCase(authentication.getName())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not authenticated"));
        return toDto(user);
    }

    private UserDto toDto(User user) {
        return new UserDto(user.getId(), user.getEmail(), user.getRole());
    }

    private void validatePasswordStrength(String rawPassword) {
        if (rawPassword == null || rawPassword.length() < 8) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password must be at least 8 characters long");
        }
        String normalized = rawPassword.toLowerCase();
        if (normalized.equals("123456") || normalized.equals("password") || normalized.equals("qwerty")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password is too weak");
        }
    }
}
