package com.cake.editor.service;

import com.cake.editor.config.ApplicationProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;

@Service
public class EmailService {

    private static final Logger log = LoggerFactory.getLogger(EmailService.class);

    private final JavaMailSender mailSender;
    private final ApplicationProperties properties;

    public EmailService(JavaMailSender mailSender, ApplicationProperties properties) {
        this.mailSender = mailSender;
        this.properties = properties;
    }

    public void sendVerificationEmail(String toEmail, String token) {
        String baseUrl = properties.getMail().getBaseUrl();
        log.info("Using base URL for verification email: '{}'", baseUrl);
        String verifyLink = baseUrl + "/verify-email?token=" + token;

        String subject = "Potwierdź rejestrację - 3D Cake Editor";
        String body = """
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
                    <h2 style="color: #f97316; margin-top: 0;">Witaj w 3D Cake Editor!</h2>
                    <p>Dziękujemy za rejestrację. Kliknij poniższy przycisk, aby potwierdzić swój adres email:</p>
                    <div style="text-align: center; margin: 28px 0;">
                        <a href="%s" style="display: inline-block; padding: 14px 32px; background: #f97316; color: #0b0b0b; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px;">
                            Potwierdź email
                        </a>
                    </div>
                    <p style="font-size: 13px; color: #999;">Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość.</p>
                </div>
                """.formatted(verifyLink);

        sendHtmlEmail(toEmail, subject, body);
    }

    public void sendPasswordResetEmail(String toEmail, String token) {
        String baseUrl = properties.getMail().getBaseUrl();
        String resetLink = baseUrl + "/reset-password?token=" + token;

        String subject = "Reset hasła - 3D Cake Editor";
        String body = """
                <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
                    <h2 style="color: #f97316; margin-top: 0;">Reset hasła</h2>
                    <p>Otrzymaliśmy prośbę o reset hasła. Kliknij poniższy przycisk, aby ustawić nowe hasło:</p>
                    <div style="text-align: center; margin: 28px 0;">
                        <a href="%s" style="display: inline-block; padding: 14px 32px; background: #f97316; color: #0b0b0b; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px;">
                            Ustaw nowe hasło
                        </a>
                    </div>
                    <p style="font-size: 13px; color: #999;">Link jest ważny przez 1 godzinę. Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość.</p>
                </div>
                """.formatted(resetLink);

        sendHtmlEmail(toEmail, subject, body);
    }

    private void sendHtmlEmail(String to, String subject, String htmlBody) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
            helper.setFrom(properties.getMail().getFrom());
            helper.setTo(to);
            helper.setSubject(subject);
            helper.setText(htmlBody, true);
            mailSender.send(message);
            log.info("Email sent to {}: {}", to, subject);
        } catch (MessagingException e) {
            log.error("Failed to send email to {}: {}", to, e.getMessage());
            throw new RuntimeException("Nie udało się wysłać emaila. Spróbuj ponownie później.", e);
        } catch (Exception e) {
            log.error("Unexpected error sending email to {}: {}", to, e.getMessage());
            throw new RuntimeException("Nie udało się wysłać emaila. Spróbuj ponownie później.", e);
        }
    }
}
