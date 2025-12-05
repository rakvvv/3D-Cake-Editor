package com.cake.editor.model;

public class TextureSetMetadata {
    private String id;
    private String label;
    private String thumbnailUrl;
    private TextureMapsMetadata cake;
    private TextureMapsMetadata glaze;

    public TextureSetMetadata() {
    }

    public TextureSetMetadata(String id, String label, String thumbnailUrl, TextureMapsMetadata cake, TextureMapsMetadata glaze) {
        this.id = id;
        this.label = label;
        this.thumbnailUrl = thumbnailUrl;
        this.cake = cake;
        this.glaze = glaze;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public void setThumbnailUrl(String thumbnailUrl) {
        this.thumbnailUrl = thumbnailUrl;
    }

    public TextureMapsMetadata getCake() {
        return cake;
    }

    public void setCake(TextureMapsMetadata cake) {
        this.cake = cake;
    }

    public TextureMapsMetadata getGlaze() {
        return glaze;
    }

    public void setGlaze(TextureMapsMetadata glaze) {
        this.glaze = glaze;
    }
}
