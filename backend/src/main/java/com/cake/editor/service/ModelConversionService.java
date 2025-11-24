package com.cake.editor.service;

import com.cake.editor.config.ApplicationProperties;
import com.cake.editor.model.ModelFormat;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

@Service
public class ModelConversionService {

    private final ApplicationProperties properties;

    public ModelConversionService(ApplicationProperties properties) {
        this.properties = properties;
    }

    public Map<ModelFormat, String> convertAndStore(String sceneId, Map<String, Object> sceneData, String sourceFormat,
                                                    List<ModelFormat> targetFormats) throws IOException {
        Map<ModelFormat, String> converted = new EnumMap<>(ModelFormat.class);
        Path sceneDirectory = properties.getStorage().resolve(sceneId);
        Files.createDirectories(sceneDirectory);

        for (ModelFormat format : targetFormats) {
            Path targetFile = sceneDirectory.resolve("scene-" + format.getSerializedName() + ".txt");
            String content = buildConversionPlaceholder(sceneData, sourceFormat, format);
            Files.writeString(targetFile, content);
            converted.put(format, properties.getStorage().resolve(sceneId).relativize(targetFile).toString());
        }
        return converted;
    }

    private String buildConversionPlaceholder(Map<String, Object> sceneData, String sourceFormat, ModelFormat targetFormat) {
        return "Converted from " + sourceFormat + " to " + targetFormat.getSerializedName() + " at " + Instant.now() +
                "\nScene summary: " + sceneData.keySet();
    }
}
