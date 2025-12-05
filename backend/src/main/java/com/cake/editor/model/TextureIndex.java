package com.cake.editor.model;

import java.util.List;

public class TextureIndex {
    private List<TextureSetMetadata> sets;

    public TextureIndex() {
    }

    public TextureIndex(List<TextureSetMetadata> sets) {
        this.sets = sets;
    }

    public List<TextureSetMetadata> getSets() {
        return sets;
    }

    public void setSets(List<TextureSetMetadata> sets) {
        this.sets = sets;
    }
}
