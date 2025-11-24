package com.cake.editor.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class SceneSaveRequest {

    private String id;

    @NotBlank
    private String name;

    private String description;

    @NotBlank
    private String sourceFormat = ModelFormat.GLTF.getSerializedName();

    @NotNull
    private Map<String, Object> scene;

    private List<String> targetFormats = new ArrayList<>();

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

    public Map<String, Object> getScene() {
        return scene;
    }

    public void setScene(Map<String, Object> scene) {
        this.scene = scene;
    }

    public List<String> getTargetFormats() {
        return targetFormats;
    }

    public void setTargetFormats(List<String> targetFormats) {
        this.targetFormats = targetFormats;
    }
}
