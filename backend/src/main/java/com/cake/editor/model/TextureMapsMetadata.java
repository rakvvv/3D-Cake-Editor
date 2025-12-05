package com.cake.editor.model;

public class TextureMapsMetadata {
    private String baseColor;
    private String normal;
    private String roughness;
    private String displacement;
    private String metallic;
    private String emissive;
    private String ambientOcclusion;
    private String alpha;
    private Boolean affectDrips;
    private Double repeat;

    public TextureMapsMetadata() {
    }

    public TextureMapsMetadata(String baseColor, String normal, String roughness, String displacement, String metallic, String emissive, String ambientOcclusion, String alpha, Boolean affectDrips, Double repeat) {
        this.baseColor = baseColor;
        this.normal = normal;
        this.roughness = roughness;
        this.displacement = displacement;
        this.metallic = metallic;
        this.emissive = emissive;
        this.ambientOcclusion = ambientOcclusion;
        this.alpha = alpha;
        this.affectDrips = affectDrips;
        this.repeat = repeat;
    }

    public String getBaseColor() {
        return baseColor;
    }

    public void setBaseColor(String baseColor) {
        this.baseColor = baseColor;
    }

    public String getNormal() {
        return normal;
    }

    public void setNormal(String normal) {
        this.normal = normal;
    }

    public String getRoughness() {
        return roughness;
    }

    public void setRoughness(String roughness) {
        this.roughness = roughness;
    }

    public String getDisplacement() {
        return displacement;
    }

    public void setDisplacement(String displacement) {
        this.displacement = displacement;
    }

    public String getMetallic() {
        return metallic;
    }

    public void setMetallic(String metallic) {
        this.metallic = metallic;
    }

    public String getEmissive() {
        return emissive;
    }

    public void setEmissive(String emissive) {
        this.emissive = emissive;
    }

    public String getAmbientOcclusion() {
        return ambientOcclusion;
    }

    public void setAmbientOcclusion(String ambientOcclusion) {
        this.ambientOcclusion = ambientOcclusion;
    }

    public String getAlpha() {
        return alpha;
    }

    public void setAlpha(String alpha) {
        this.alpha = alpha;
    }

    public Boolean getAffectDrips() {
        return affectDrips;
    }

    public void setAffectDrips(Boolean affectDrips) {
        this.affectDrips = affectDrips;
    }

    public Double getRepeat() {
        return repeat;
    }

    public void setRepeat(Double repeat) {
        this.repeat = repeat;
    }
}
