package com.cake.editor.model;

public class DecorationMetadata {
    private String id;
    private String name;
    private String category;
    private String format;
    private String previewUrl;

    public DecorationMetadata() {
    }

    public DecorationMetadata(String id, String name, String category, String format, String previewUrl) {
        this.id = id;
        this.name = name;
        this.category = category;
        this.format = format;
        this.previewUrl = previewUrl;
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

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public String getFormat() {
        return format;
    }

    public void setFormat(String format) {
        this.format = format;
    }

    public String getPreviewUrl() {
        return previewUrl;
    }

    public void setPreviewUrl(String previewUrl) {
        this.previewUrl = previewUrl;
    }
}
