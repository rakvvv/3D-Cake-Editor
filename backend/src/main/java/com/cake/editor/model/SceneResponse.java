package com.cake.editor.model;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class SceneResponse {
    private String id;
    private String name;
    private String description;
    private String sourceFormat;
    private Instant createdAt;
    private Map<String, Object> scene;
    private Map<ModelFormat, String> convertedModels;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getSourceFormat() {
        return sourceFormat;
    }

    public void setSourceFormat(String sourceFormat) {
        this.sourceFormat = sourceFormat;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Map<String, Object> getScene() {
        return scene;
    }

    public void setScene(Map<String, Object> scene) {
        this.scene = scene;
    }

    public Map<ModelFormat, String> getConvertedModels() {
        return convertedModels;
    }

    public void setConvertedModels(Map<ModelFormat, String> convertedModels) {
        this.convertedModels = convertedModels;
    }
}
