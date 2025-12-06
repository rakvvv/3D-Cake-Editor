package com.cake.editor.model;

public class DecorationMetadata {
    private String id;
    private String name;
    private String modelFileName;
    private String type;
    private String thumbnailUrl;
    private Boolean paintable;
    private Double initialScale;

    public DecorationMetadata() {
    }

    public DecorationMetadata(String id, String name, String modelFileName, String type, String thumbnailUrl, Boolean paintable, Double initialScale) {
        this.id = id;
        this.name = name;
        this.modelFileName = modelFileName;
        this.type = type;
        this.thumbnailUrl = thumbnailUrl;
        this.paintable = paintable;
        this.initialScale = initialScale;
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

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }

    public Boolean getPaintable() {
        return paintable;
    }

    public void setPaintable(Boolean paintable) {
        this.paintable = paintable;
    }

    public Double getInitialScale() {
        return initialScale;
    }

    public void setInitialScale(Double initialScale) {
        this.initialScale = initialScale;
    }
}
