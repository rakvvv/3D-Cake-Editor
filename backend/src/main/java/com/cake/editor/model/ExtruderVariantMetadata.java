package com.cake.editor.model;

public class ExtruderVariantMetadata {
    private String id;
    private String name;
    private String modelFileName;
    private Double scaleMultiplier;
    private String thumbnailUrl;

    public ExtruderVariantMetadata() {
    }

    public ExtruderVariantMetadata(String id, String name, String modelFileName, Double scaleMultiplier, String thumbnailUrl) {
        this.id = id;
        this.name = name;
        this.modelFileName = modelFileName;
        this.scaleMultiplier = scaleMultiplier;
        this.thumbnailUrl = thumbnailUrl;
    }

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

    public String getModelFileName() {
        return modelFileName;
    }

    public void setModelFileName(String modelFileName) {
        this.modelFileName = modelFileName;
    }

    public Double getScaleMultiplier() {
        return scaleMultiplier;
    }

    public void setScaleMultiplier(Double scaleMultiplier) {
        this.scaleMultiplier = scaleMultiplier;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }
}
