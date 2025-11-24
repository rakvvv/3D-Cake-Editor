package com.cake.editor.service;

import com.cake.editor.config.ApplicationProperties;
import com.cake.editor.model.ModelFormat;
import com.cake.editor.model.SceneSaveRequest;
import com.cake.editor.model.StoredScene;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class SceneStorageService {

    private final ApplicationProperties properties;
    private final ModelConversionService conversionService;
    private final ObjectMapper objectMapper;

    public SceneStorageService(ApplicationProperties properties, ModelConversionService conversionService, ObjectMapper objectMapper) {
        this.properties = properties;
        this.conversionService = conversionService;
        this.objectMapper = objectMapper;
    }

    public StoredScene save(SceneSaveRequest request) {
        String sceneId = request.getId() != null ? request.getId() : UUID.randomUUID().toString();
        Instant createdAt = Instant.now();
        List<ModelFormat> targetFormats = resolveTargetFormats(request.getTargetFormats());

        try {
            Map<ModelFormat, String> convertedModels = conversionService.convertAndStore(sceneId, request.getScene(),
                    request.getSourceFormat(), targetFormats);
            StoredScene storedScene = new StoredScene(sceneId, request.getName(), request.getDescription(),
                    request.getSourceFormat(), createdAt, request.getScene(), convertedModels);

            writeSceneToDisk(storedScene);
            return storedScene;
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to store scene", exception);
        }
    }

    public StoredScene getById(String id) {
        Path scenePath = getScenePath(id);
        if (!Files.exists(scenePath)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Scene not found");
        }
        try {
            return objectMapper.readValue(scenePath.toFile(), StoredScene.class);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Could not read stored scene", exception);
        }
    }

    private void writeSceneToDisk(StoredScene scene) throws IOException {
        Path sceneDirectory = properties.getStorage().resolve(scene.getId());
        Files.createDirectories(sceneDirectory);
        objectMapper.writerWithDefaultPrettyPrinter().writeValue(sceneDirectory.resolve("scene.json").toFile(), scene);
    }

    private Path getScenePath(String id) {
        return properties.getStorage().resolve(id).resolve("scene.json");
    }

    private List<ModelFormat> resolveTargetFormats(List<String> targetFormats) {
        if (targetFormats == null || targetFormats.isEmpty()) {
            return List.of(ModelFormat.GLTF, ModelFormat.OBJ, ModelFormat.STL);
        }
        return targetFormats.stream()
                .map(ModelFormat::fromString)
                .distinct()
                .collect(Collectors.toList());
    }
}
