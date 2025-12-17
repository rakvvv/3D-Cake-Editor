package com.cake.editor.service;

import com.cake.editor.config.ApplicationProperties;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

@Service
public class ThumbnailService {

    private final ApplicationProperties properties;

    public ThumbnailService(ApplicationProperties properties) {
        this.properties = properties;
    }

    public void saveCakeThumbnail(Long projectId, MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            throw new IOException("Empty thumbnail file");
        }

        Path target = getCakeThumbnailPath(projectId);
        Files.createDirectories(target.getParent());
        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public Resource loadCakeThumbnail(Long projectId) throws MalformedURLException {
        Path target = getCakeThumbnailPath(projectId);
        if (!Files.exists(target)) {
            return null;
        }
        return new UrlResource(target.toUri());
    }

    public void savePresetThumbnail(String presetId, MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            throw new IOException("Empty thumbnail file");
        }

        Path target = getPresetThumbnailPath(presetId);
        Files.createDirectories(target.getParent());
        try (InputStream inputStream = file.getInputStream()) {
            Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    public Resource loadPresetThumbnail(String presetId) throws MalformedURLException {
        Path target = getPresetThumbnailPath(presetId);
        if (!Files.exists(target)) {
            return null;
        }
        return new UrlResource(target.toUri());
    }

    private Path getCakeThumbnailPath(Long projectId) {
        return properties.getStorage().resolve("thumbnails").resolve("cakes").resolve(projectId + ".png");
    }

    private Path getPresetThumbnailPath(String presetId) {
        return properties.getStorage().resolve("thumbnails").resolve("presets").resolve(presetId + ".png");
    }
}
